import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { pool } from "../../db";
import {
  createSession,
  updateSessionWithClarity,
  getSession,
  listSessions,
  type ClarityData,
} from "../../repositories/sessionRepository";
import {
  approveReviewParagraph,
  approveReviewPage,
  deleteReviewParagraph,
  ensureReviewPreview,
  getReviewPreviewByPlanId,
  groupParagraphsByPage,
  isReviewPreviewGenerationInProgress,
  getReviewPageProgress,
  replaceParagraphContent,
  updateReviewParagraphContent,
  type PlanStructureSegment,
  type ReviewPreviewParagraph,
} from "../../repositories/reviewPreviewRepository";
import {
  harmonizeSegmentFlowWithPrevious,
  refineParagraphWithAi,
  stabilizeParagraphFlow,
} from "../../services/reviewRefinementService";
import { normalizeTrustedUrl } from "../../repositories/reviewPreview/sourceDiscovery";
import { decideClarityNextStep } from "../../services/clarityLoopService";
import { classifyInput } from "../../services/inputClassifier";
import {
  approvePlanInDatabase,
  generateResearchPlan,
  storePlanInDatabase,
  updatePlanDraftInDatabase,
  type EditablePlanPayload,
  type PlanningInput,
} from "../../services/planningService";
import { defaultClarityQuestions } from "./constants";
import { normalizeAndValidateSegments } from "./segmentValidation";
import type {
  ApproveReviewPageBody,
  ClarityBody,
  PlanResearchBody,
  ReviewParagraphActionBody,
  ReviewParagraphRefineBody,
  StartResearchBody,
  UpdatePlanBody,
} from "./types";

interface ReviewPlanRecord {
  id: string;
  structure: unknown;
  status: string;
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch?.[1]?.replace(/\s+/g, " ").trim() || "Untitled page";
}

function buildPreviewExcerpt(text: string, maxLength = 2200): string {
  if (!text) {
    return "";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trim()}...`;
}

function looksLikeBlockedOrRedirectPage(text: string, title: string): boolean {
  const combined = `${title} ${text}`.toLowerCase();

  const markers = [
    "redirecting",
    "just a moment",
    "checking your browser",
    "enable javascript",
    "access denied",
    "forbidden",
    "captcha",
    "sign in",
    "log in",
    "cookie policy",
  ];

  return markers.some((marker) => combined.includes(marker));
}

async function fetchReaderFallback(url: string): Promise<{ title: string; excerpt: string } | null> {
  const readerUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(readerUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WebResearcherAgent/1.0)",
        Accept: "text/plain",
      },
    });

    if (!response.ok) {
      return null;
    }

    const rawText = (await response.text()).trim();
    if (rawText.length < 120) {
      return null;
    }

    const lines = rawText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const title = lines[0]?.replace(/^#+\s*/, "") || "Webpage preview";
    const excerpt = buildPreviewExcerpt(rawText);

    if (!excerpt || looksLikeBlockedOrRedirectPage(excerpt, title)) {
      return null;
    }

    return { title, excerpt };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getPlanForReview(
  sessionId: string,
  requestedPlanId: string,
): Promise<ReviewPlanRecord | null> {
  const result = requestedPlanId
    ? await pool.query(
        `
        SELECT id, structure, status
        FROM research_plans
        WHERE session_id = $1 AND id = $2
        LIMIT 1
      `,
        [sessionId, requestedPlanId],
      )
    : await pool.query(
        `
        SELECT id, structure, status
        FROM research_plans
        WHERE session_id = $1
        ORDER BY CASE WHEN status = 'approved' THEN 0 ELSE 1 END, updated_at DESC
        LIMIT 1
      `,
        [sessionId],
      );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0] as ReviewPlanRecord;
}

function normalizePlanSegments(structure: unknown): PlanStructureSegment[] {
  if (!Array.isArray(structure)) {
    return [];
  }

  const segments: PlanStructureSegment[] = [];
  for (const entry of structure) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const segment = entry as {
      order?: unknown;
      title?: unknown;
      topic?: unknown;
    };

    const order = Number(segment.order);
    const title = String(segment.title || "").trim();
    const topic = String(segment.topic || "").trim();

    if (!Number.isFinite(order) || order < 1 || !title || !topic) {
      continue;
    }

    segments.push({
      order,
      title,
      topic,
    });
  }

  return segments.sort((a, b) => a.order - b.order);
}

function getParagraphContext(
  paragraphs: ReviewPreviewParagraph[],
  paragraphId: string,
): {
  paragraph: ReviewPreviewParagraph;
  previous: ReviewPreviewParagraph | null;
  next: ReviewPreviewParagraph | null;
} | null {
  const sorted = [...paragraphs].sort((a, b) => a.order - b.order);
  const index = sorted.findIndex((paragraph) => paragraph.id === paragraphId);
  if (index < 0) {
    return null;
  }

  return {
    paragraph: sorted[index],
    previous: index > 0 ? sorted[index - 1] : null,
    next: index < sorted.length - 1 ? sorted[index + 1] : null,
  };
}

async function buildReviewPreviewPayload(
  sessionId: string,
  planId: string,
  topic: string,
  planStatus: string,
): Promise<{
  sessionId: string;
  planId: string;
  topic: string;
  planStatus: string;
  approvedSegmentOrders: number[];
  pages: ReturnType<typeof groupParagraphsByPage>;
  paragraphs: ReviewPreviewParagraph[];
}> {
  const paragraphs = await getReviewPreviewByPlanId(sessionId, planId);
  const progress = await getReviewPageProgress(sessionId, planId);

  return {
    sessionId,
    planId,
    topic,
    planStatus,
    approvedSegmentOrders: progress.approvedSegmentOrders,
    pages: groupParagraphsByPage(topic, paragraphs),
    paragraphs,
  };
}

/**
 * 
 * @param req {Request} : Contains the topic and preferred sites for starting a research session.
 * the topic is classified as either 'descriptive' or 'vague'. If 'vague', follow-up clarity questions are generated. 
 * @param res 
 * @returns 
 */
export async function startResearchHandler(
  req: Request,
  res: Response,
): Promise<Response> {
  const body = req.body as StartResearchBody;

  const topic = (body.topic || "").trim();
  const preferredSites = Array.isArray(body.preferredSites)
    ? body.preferredSites
        .map((site) => String(site).trim())
        .filter((site) => site.length > 0)
    : [];

  if (!topic) {
    return res.status(400).json({
      message: "Topic is required.",
    });
  }

  const classification = await classifyInput(topic);
  const sessionId = randomUUID();

  await createSession({
    id: sessionId,
    topic,
    rawInput: topic,
    inputCategory: classification.category,
    preferredSites,
  });

  const nextStep: "ask_clarity_questions" | "generate_research_plan" =
    classification.category === "vague"
      ? "ask_clarity_questions"
      : "generate_research_plan";
  let followUpQuestions: string[] = [];
  let clarityRound = 1;

  if (classification.category === "vague") {
    try {
      const clarityDecision = await decideClarityNextStep({
        topic,
        userBackground: "student",
        researchGoal: "",
        sourcePreferences: [],
        followUpResponses: [],
        clarityRound: 1,
      });

      if (
        clarityDecision.nextStep === "ask_clarity_questions" &&
        clarityDecision.followUpQuestions.length > 0
      ) {
        followUpQuestions = clarityDecision.followUpQuestions;
        clarityRound = clarityDecision.clarityRound;
      } else {
        // Keep vague inputs in clarity flow with deterministic starter questions.
        followUpQuestions = defaultClarityQuestions;
        clarityRound = 2;
      }
    } catch (error) {
      console.error(
        "[research-start] Failed to generate initial clarity questions; using defaults.",
        error,
      );
      followUpQuestions = defaultClarityQuestions;
      clarityRound = 2;
    }
  }

  return res.status(201).json({
    sessionId,
    topic,
    inputCategory: classification.category,
    confidence: classification.confidence,
    reasoning: classification.reasoning,
    nextStep,
    followUpQuestions,
    clarityRound,
  });
}

export async function submitClarityHandler(
  req: Request,
  res: Response,
): Promise<Response> {
  const sessionId = String(req.params.sessionId || "");
  const body = req.body as ClarityBody;

  const session = await getSession(sessionId);
  if (!session) {
    return res.status(404).json({ message: "Session not found." });
  }

  const userBackground = (body.userBackground || "student") as
    | "researcher"
    | "student"
    | "teacher";
  const researchGoal = (body.researchGoal || "").trim();
  const sourcePreferences = (
    Array.isArray(body.sourcePreferences)
      ? body.sourcePreferences
      : ["reputable_only"]
  ) as (
    | "research_papers"
    | "articles_news"
    | "academic_papers"
    | "reputable_only"
  )[];
  const clarityRound = Number(body.clarityRound || 1);
  const followUpResponses = Array.isArray(body.followUpResponses)
    ? body.followUpResponses
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
    : [];

  if (!researchGoal) {
    return res.status(400).json({
      message: "Research goal is required.",
    });
  }

  const combinedResearchGoal = [researchGoal, ...followUpResponses]
    .filter(Boolean)
    .join("\n\n");

  const clarity: ClarityData = {
    userBackground,
    researchGoal: combinedResearchGoal,
    sourcePreferences,
  };

  await updateSessionWithClarity(sessionId, clarity);

  const clarityDecision = await decideClarityNextStep({
    topic: session.topic,
    userBackground,
    researchGoal: combinedResearchGoal,
    sourcePreferences,
    followUpResponses,
    clarityRound,
  });

  return res.status(200).json({
    sessionId,
    message: clarityDecision.message,
    nextStep: clarityDecision.nextStep,
    followUpQuestions: clarityDecision.followUpQuestions,
    clarityRound: clarityDecision.clarityRound,
  });
}

export async function planResearchHandler(
  req: Request,
  res: Response,
): Promise<Response> {
  const sessionId = String(req.params.sessionId || "");
  const body = req.body as PlanResearchBody;

  const session = await getSession(sessionId);
  if (!session) {
    return res.status(404).json({ message: "Session not found." });
  }

  try {
    const clarityResult = await pool.query(
      `SELECT user_background, research_goal, source_preferences FROM sessions WHERE id = $1`,
      [sessionId],
    );

    if (clarityResult.rows.length === 0) {
      return res.status(400).json({
        message: "Clarity information not found. Please provide clarity first.",
      });
    }

    const clarityRow = clarityResult.rows[0] as {
      user_background?: string;
      research_goal?: string;
      source_preferences?: unknown;
    };
    const userBackground = (clarityRow.user_background || "student") as
      | "researcher"
      | "student"
      | "teacher";
    const sourcePreferences = ((clarityRow.source_preferences as unknown[]) || [
      "reputable_only",
    ]) as (
      | "research_papers"
      | "articles_news"
      | "academic_papers"
      | "reputable_only"
    )[];
    const endGoal = body.endGoal || "evaluate_and_explain";

    const planningInput: PlanningInput = {
      topic: session.topic,
      userBackground,
      endGoal,
      sourcePreferences,
    };

    const plan = await generateResearchPlan(planningInput);
    const { planId } = await storePlanInDatabase(sessionId, plan);

    return res.status(200).json({
      sessionId,
      planId,
      topic: session.topic,
      totalPages: plan.totalPages,
      segmentCount: plan.segments.length,
      segments: plan.segments,
      planMarkdown: plan.planMarkdown,
    });
  } catch (error) {
    console.error("Error planning research:", error);
    return res.status(500).json({
      message: "Failed to generate research plan.",
    });
  }
}

export async function updatePlanHandler(
  req: Request,
  res: Response,
): Promise<Response> {
  const sessionId = String(req.params.sessionId || "");
  const planId = String(req.params.planId || "");
  const body = req.body as UpdatePlanBody;

  const session = await getSession(sessionId);
  if (!session) {
    return res.status(404).json({ message: "Session not found." });
  }

  const totalPages = Number(body.totalPages || 0);
  if (!Number.isFinite(totalPages) || totalPages < 1) {
    return res.status(400).json({ message: "Total pages must be at least 1." });
  }

  const segmentValidation = normalizeAndValidateSegments(body.segments || []);
  if (!segmentValidation.ok) {
    return res.status(400).json({ message: segmentValidation.message });
  }

  const draft: EditablePlanPayload = {
    totalPages,
    segments: segmentValidation.value,
  };

  try {
    const { planMarkdown } = await updatePlanDraftInDatabase(
      sessionId,
      planId,
      session.topic,
      draft,
    );

    return res.status(200).json({
      sessionId,
      planId,
      topic: session.topic,
      totalPages: draft.totalPages,
      segmentCount: draft.segments.length,
      segments: draft.segments,
      planMarkdown,
      status: "pending_approval",
    });
  } catch (error) {
    console.error("Error updating plan draft:", error);
    return res.status(500).json({ message: "Failed to update plan draft." });
  }
}

export async function approvePlanHandler(
  req: Request,
  res: Response,
): Promise<Response> {
  const sessionId = String(req.params.sessionId || "");
  const planId = String(req.params.planId || "");

  const session = await getSession(sessionId);
  if (!session) {
    return res.status(404).json({ message: "Session not found." });
  }

  try {
    await approvePlanInDatabase(sessionId, planId);
    return res.status(200).json({
      sessionId,
      planId,
      status: "approved",
      nextStep: "review_preview",
    });
  } catch (error) {
    console.error("Error approving plan:", error);
    return res.status(500).json({ message: "Failed to approve plan." });
  }
}

export async function reviewPreviewHandler(
  req: Request,
  res: Response,
): Promise<Response> {
  const sessionId = String(req.params.sessionId || "");
  const requestedPlanId = String(req.query.planId || "").trim();

  const session = await getSession(sessionId);
  if (!session) {
    return res.status(404).json({ message: "Session not found." });
  }

  try {
    const planRow = await getPlanForReview(sessionId, requestedPlanId);
    if (!planRow) {
      return res.status(404).json({
        message: "No research plan found for review preview.",
      });
    }

    const segments = normalizePlanSegments(planRow.structure);
    if (segments.length === 0) {
      return res.status(404).json({
        message: "No plan segments available for review preview.",
      });
    }

    const paragraphs = await ensureReviewPreview({
      sessionId,
      planId: planRow.id,
      topic: session.topic,
      segments,
    });

    const payload = await buildReviewPreviewPayload(
      sessionId,
      planRow.id,
      session.topic,
      planRow.status,
    );

    return res.status(200).json({
      ...payload,
      isGenerating: isReviewPreviewGenerationInProgress(sessionId, planRow.id),
    });
  } catch (error) {
    console.error("Error generating review preview:", error);
    return res.status(500).json({
      message: "Failed to load review preview.",
    });
  }
}

export async function approveReviewPageHandler(
  req: Request,
  res: Response,
): Promise<Response> {
  const sessionId = String(req.params.sessionId || "");
  const body = req.body as ApproveReviewPageBody;
  const planId = String(body.planId || "").trim();
  const segmentOrder = Number(body.segmentOrder || 0);

  if (!planId) {
    return res.status(400).json({ message: "Plan ID is required." });
  }

  if (!Number.isInteger(segmentOrder) || segmentOrder < 1) {
    return res.status(400).json({ message: "Segment order is required." });
  }

  const session = await getSession(sessionId);
  if (!session) {
    return res.status(404).json({ message: "Session not found." });
  }

  try {
    const planRow = await getPlanForReview(sessionId, planId);
    if (!planRow) {
      return res.status(404).json({ message: "No research plan found for approval." });
    }

    const segments = normalizePlanSegments(planRow.structure);
    if (segments.length === 0) {
      return res.status(404).json({ message: "No plan segments available for approval." });
    }

    await ensureReviewPreview({
      sessionId,
      planId: planRow.id,
      topic: session.topic,
      segments,
    });

    const paragraphsBeforeApprove = await getReviewPreviewByPlanId(sessionId, planRow.id);
    const previousPageParagraphs = paragraphsBeforeApprove.filter(
      (paragraph) =>
        paragraph.segmentOrder === segmentOrder - 1 && paragraph.status === "approved",
    );
    const currentPageParagraphs = paragraphsBeforeApprove.filter(
      (paragraph) => paragraph.segmentOrder === segmentOrder && paragraph.status === "approved",
    );

    const transitionAdjustments = await harmonizeSegmentFlowWithPrevious(
      session.topic,
      previousPageParagraphs,
      currentPageParagraphs,
    );

    for (const adjustment of transitionAdjustments) {
      await replaceParagraphContent({
        sessionId,
        planId: planRow.id,
        paragraphId: adjustment.paragraphId,
        nextContent: adjustment.nextContent,
      });
    }

    const updatedParagraphs = await approveReviewPage({
      sessionId,
      planId: planRow.id,
      topic: session.topic,
      segments,
      segmentOrder,
    });

    const progress = await getReviewPageProgress(sessionId, planRow.id);

    return res.status(200).json({
      sessionId,
      planId: planRow.id,
      topic: session.topic,
      planStatus: planRow.status,
      approvedSegmentOrders: progress.approvedSegmentOrders,
      pages: groupParagraphsByPage(session.topic, updatedParagraphs),
      paragraphs: updatedParagraphs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to approve review page.";
    console.error("Error approving review page:", error);
    return res.status(400).json({ message });
  }
}

export async function refineReviewParagraphHandler(
  req: Request,
  res: Response,
): Promise<Response> {
  const sessionId = String(req.params.sessionId || "");
  const paragraphId = String(req.params.paragraphId || "").trim();
  const body = req.body as ReviewParagraphRefineBody;
  const planId = String(body.planId || "").trim();
  const mode = body.mode === "ai" ? "ai" : "manual";

  if (!planId) {
    return res.status(400).json({ message: "Plan ID is required." });
  }

  if (!paragraphId) {
    return res.status(400).json({ message: "Paragraph ID is required." });
  }

  const session = await getSession(sessionId);
  if (!session) {
    return res.status(404).json({ message: "Session not found." });
  }

  try {
    const planRow = await getPlanForReview(sessionId, planId);
    if (!planRow) {
      return res.status(404).json({ message: "No research plan found." });
    }

    const paragraphs = await getReviewPreviewByPlanId(sessionId, planRow.id);
    const context = getParagraphContext(paragraphs, paragraphId);
    if (!context) {
      return res.status(404).json({ message: "Paragraph not found in this plan." });
    }

    const requestedContent = String(body.content || "").trim();
    let nextContent = requestedContent;

    if (mode === "manual") {
      if (!requestedContent) {
        return res.status(400).json({ message: "Manual refinement requires content." });
      }
    } else {
      const aiRefined = await refineParagraphWithAi({
        topic: session.topic,
        segmentTitle: context.paragraph.segmentTitle,
        paragraphContent: context.paragraph.content,
        previousParagraphContent: context.previous?.content || null,
        nextParagraphContent: context.next?.content || null,
        sources: context.paragraph.sources,
        instruction: body.instruction,
      });

      if (!aiRefined) {
        return res.status(503).json({
          message: "AI refinement is currently unavailable. Please refine manually.",
        });
      }

      nextContent = aiRefined;
    }

    const stabilized = await stabilizeParagraphFlow({
      topic: session.topic,
      segmentTitle: context.paragraph.segmentTitle,
      previousParagraphContent: context.previous?.content || null,
      nextParagraphContent: context.next?.content || null,
      previousVersionContent: context.paragraph.previousContent,
      currentDraft: nextContent,
    });

    await updateReviewParagraphContent({
      sessionId,
      planId: planRow.id,
      paragraphId,
      nextContent: stabilized,
      editedBy: mode,
    });

    const payload = await buildReviewPreviewPayload(
      sessionId,
      planRow.id,
      session.topic,
      planRow.status,
    );

    return res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to refine paragraph.";
    console.error("Error refining review paragraph:", error);
    return res.status(400).json({ message });
  }
}

export async function approveReviewParagraphHandler(
  req: Request,
  res: Response,
): Promise<Response> {
  const sessionId = String(req.params.sessionId || "");
  const paragraphId = String(req.params.paragraphId || "").trim();
  const body = req.body as ReviewParagraphActionBody;
  const planId = String(body.planId || "").trim();

  if (!planId) {
    return res.status(400).json({ message: "Plan ID is required." });
  }

  if (!paragraphId) {
    return res.status(400).json({ message: "Paragraph ID is required." });
  }

  const session = await getSession(sessionId);
  if (!session) {
    return res.status(404).json({ message: "Session not found." });
  }

  try {
    const planRow = await getPlanForReview(sessionId, planId);
    if (!planRow) {
      return res.status(404).json({ message: "No research plan found." });
    }

    await approveReviewParagraph({ sessionId, planId: planRow.id, paragraphId });

    const payload = await buildReviewPreviewPayload(
      sessionId,
      planRow.id,
      session.topic,
      planRow.status,
    );

    return res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to approve paragraph.";
    console.error("Error approving review paragraph:", error);
    return res.status(400).json({ message });
  }
}

export async function deleteReviewParagraphHandler(
  req: Request,
  res: Response,
): Promise<Response> {
  const sessionId = String(req.params.sessionId || "");
  const paragraphId = String(req.params.paragraphId || "").trim();
  const body = req.body as ReviewParagraphActionBody;
  const planId = String(body.planId || "").trim();

  if (!planId) {
    return res.status(400).json({ message: "Plan ID is required." });
  }

  if (!paragraphId) {
    return res.status(400).json({ message: "Paragraph ID is required." });
  }

  const session = await getSession(sessionId);
  if (!session) {
    return res.status(404).json({ message: "Session not found." });
  }

  try {
    const planRow = await getPlanForReview(sessionId, planId);
    if (!planRow) {
      return res.status(404).json({ message: "No research plan found." });
    }

    await deleteReviewParagraph({ sessionId, planId: planRow.id, paragraphId });

    const payload = await buildReviewPreviewPayload(
      sessionId,
      planRow.id,
      session.topic,
      planRow.status,
    );

    return res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete paragraph.";
    console.error("Error deleting review paragraph:", error);
    return res.status(400).json({ message });
  }
}

export async function reviewExportHandler(
  req: Request,
  res: Response,
): Promise<Response> {
  const sessionId = String(req.params.sessionId || "");
  const requestedPlanId = String(req.query.planId || "").trim();

  const session = await getSession(sessionId);
  if (!session) {
    return res.status(404).json({ message: "Session not found." });
  }

  try {
    const planRow = await getPlanForReview(sessionId, requestedPlanId);
    if (!planRow) {
      return res.status(404).json({
        message: "No research plan found for review export.",
      });
    }

    const segments = normalizePlanSegments(planRow.structure);
    if (segments.length === 0) {
      return res.status(404).json({
        message: "No plan segments available for review export.",
      });
    }

    const paragraphs = await ensureReviewPreview({
      sessionId,
      planId: planRow.id,
      topic: session.topic,
      segments,
    });

    const sourceRows = paragraphs.flatMap((paragraph) =>
      paragraph.sources.map((source) => ({
        ...source,
        paragraphId: paragraph.id,
        paragraphOrder: paragraph.order,
      })),
    );

    return res.status(200).json({
      sessionId,
      planId: planRow.id,
      topic: session.topic,
      planStatus: planRow.status,
      exportedAt: new Date().toISOString(),
      pageCount: groupParagraphsByPage(session.topic, paragraphs).length,
      paragraphCount: paragraphs.length,
      sourceCount: sourceRows.length,
      pages: groupParagraphsByPage(session.topic, paragraphs).map((page) => ({
        segmentOrder: page.segmentOrder,
        segmentTitle: page.segmentTitle,
        topic: page.topic,
        paragraphs: page.paragraphs.map((paragraph) => ({
          id: paragraph.id,
          order: paragraph.order,
          paragraphIndex: paragraph.paragraphIndex,
          content: paragraph.content,
        })),
      })),
      paragraphs: paragraphs.map((paragraph) => ({
        id: paragraph.id,
        order: paragraph.order,
        segmentOrder: paragraph.segmentOrder,
        paragraphIndex: paragraph.paragraphIndex,
        segmentTitle: paragraph.segmentTitle,
        content: paragraph.content,
        citations: paragraph.sources.map((source) => ({
          sourceId: source.id,
          title: source.title,
          url: source.url,
          excerpt: source.excerpt,
        })),
      })),
      sources: sourceRows,
    });
  } catch (error) {
    console.error("Error exporting review data:", error);
    return res.status(500).json({
      message: "Failed to export review data.",
    });
  }
}

export async function sourcePreviewHandler(
  req: Request,
  res: Response,
): Promise<Response> {
  const sessionId = String(req.params.sessionId || "");
  const rawUrl = String(req.query.url || "").trim();

  if (!rawUrl) {
    return res.status(400).json({ message: "Source URL is required." });
  }

  const session = await getSession(sessionId);
  if (!session) {
    return res.status(404).json({ message: "Session not found." });
  }

  const normalized = normalizeTrustedUrl(rawUrl);
  if (!normalized) {
    return res.status(400).json({ message: "Source URL is not allowed." });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    let title = "";
    let excerpt = "";

    try {
      const response = await fetch(normalized, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; WebResearcherAgent/1.0)",
          Accept: "text/html,application/xhtml+xml",
        },
      });

      if (response.ok) {
        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
          const html = await response.text();
          title = extractTitle(html);
          const text = stripHtmlToText(html);
          excerpt = buildPreviewExcerpt(text);
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!excerpt || excerpt.length < 180 || looksLikeBlockedOrRedirectPage(excerpt, title)) {
      const fallback = await fetchReaderFallback(normalized);
      if (fallback) {
        title = fallback.title;
        excerpt = fallback.excerpt;
      }
    }

    if (!excerpt) {
      return res.status(502).json({
        message:
          "Could not load a stable preview for this source. Open it in a full tab for direct access.",
      });
    }

    return res.status(200).json({
      url: normalized,
      title: title || "Webpage preview",
      excerpt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to preview source.";
    return res.status(502).json({ message });
  }
}

export async function listSessionsHandler(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const sessions = await listSessions();
    return res.status(200).json(sessions);
  } catch (error) {
    console.error("Error listing sessions:", error);
    return res.status(500).json({
      message: "Failed to list sessions.",
    });
  }
}
