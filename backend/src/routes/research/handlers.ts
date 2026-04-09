import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { pool } from "../../db";
import {
  createSession,
  updateSessionWithClarity,
  getSession,
  type ClarityData,
} from "../../repositories/sessionRepository";
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
  ClarityBody,
  PlanResearchBody,
  StartResearchBody,
  UpdatePlanBody,
} from "./types";

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
      nextStep: "research_segment_cycles",
    });
  } catch (error) {
    console.error("Error approving plan:", error);
    return res.status(500).json({ message: "Failed to approve plan." });
  }
}
