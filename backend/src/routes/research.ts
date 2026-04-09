// Accepts { topic, preferredSites } from frontend
// Classifies input (vague/descriptive)
// Creates session record in PostgreSQL
// Returns classification + sessionId + nextStep routing decision


import { Router } from "express";
import { randomUUID } from "crypto";
import { classifyInput } from "../services/inputClassifier";
import {
  createSession,
  updateSessionWithClarity,
  getSession,
  type ClarityData,
} from "../repositories/sessionRepository";
import {
  approvePlanInDatabase,
  generateResearchPlan,
  storePlanInDatabase,
  updatePlanDraftInDatabase,
  type EditablePlanPayload,
  type PlanningInput,
  type ResearchSegment,
} from "../services/planningService";

interface StartResearchBody {
  topic?: string;
  preferredSites?: string[];
}

interface ClarityBody {
  userBackground?: "researcher" | "student" | "teacher";
  researchGoal?: string;
  sourcePreferences?: (
    | "research_papers"
    | "articles_news"
    | "academic_papers"
    | "reputable_only"
  )[];
}

interface PlanResearchBody {
  endGoal?: "propose_solutions" | "evaluate_and_explain" | "explore_current_approaches";
}

interface UpdatePlanBody {
  totalPages?: number;
  segments?: ResearchSegment[];
}

function normalizeAndValidateSegments(
  segments: ResearchSegment[]
): { ok: true; value: ResearchSegment[] } | { ok: false; message: string } {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { ok: false, message: "Plan must contain at least one segment." };
  }

  const cleaned = segments.map((segment, index) => {
    const title = String(segment.title || "").trim();
    const topic = String(segment.topic || "").trim();
    const queries = Array.isArray(segment.searchQueries)
      ? segment.searchQueries.map((query) => String(query).trim()).filter(Boolean)
      : [];

    return {
      order: index + 1,
      title,
      topic,
      searchQueries: queries,
    };
  });

  for (const segment of cleaned) {
    if (!segment.title) {
      return { ok: false, message: "Every segment needs a title." };
    }
    if (!segment.topic) {
      return { ok: false, message: "Every segment needs a topic description." };
    }
    if (segment.searchQueries.length === 0) {
      return {
        ok: false,
        message: "Every segment needs at least one search query.",
      };
    }
  }

  return { ok: true, value: cleaned };
}

const router = Router();

router.post("/start", async (req, res) => {
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

  return res.status(201).json({
    sessionId,
    topic,
    inputCategory: classification.category,
    confidence: classification.confidence,
    reasoning: classification.reasoning,
    nextStep:
      classification.category === "vague"
        ? "ask_clarity_questions"
        : "generate_research_plan",
  });
});

router.post("/:sessionId/clarity", async (req, res) => {
  const { sessionId } = req.params;
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
    Array.isArray(body.sourcePreferences) ? body.sourcePreferences : ["reputable_only"]
  ) as (
    | "research_papers"
    | "articles_news"
    | "academic_papers"
    | "reputable_only"
  )[];

  if (!researchGoal) {
    return res.status(400).json({
      message: "Research goal is required.",
    });
  }

  const clarity: ClarityData = {
    userBackground,
    researchGoal,
    sourcePreferences,
  };

  await updateSessionWithClarity(sessionId, clarity);

  return res.status(200).json({
    sessionId,
    message: "Clarity questions answered.",
    nextStep: "generate_research_plan",
  });
});

router.post("/:sessionId/plan-research", async (req, res) => {
  const { sessionId } = req.params;
  const body = req.body as PlanResearchBody;

  const session = await getSession(sessionId);
  if (!session) {
    return res.status(404).json({ message: "Session not found." });
  }

  try {
    // Query clarity data from database
    const clarityResult = await require("../db").pool.query(
      `SELECT user_background, research_goal, source_preferences FROM sessions WHERE id = $1`,
      [sessionId]
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
    const sourcePreferences = (
      (clarityRow.source_preferences as unknown[]) || ["reputable_only"]
    ) as (
      | "research_papers"
      | "articles_news"
      | "academic_papers"
      | "reputable_only"
    )[];
    const endGoal = body.endGoal || "evaluate_and_explain";

    const planningInput: PlanningInput = {
      topic: session.topic,
      userBackground: userBackground as
        | "researcher"
        | "student"
        | "teacher",
      endGoal: endGoal as
        | "propose_solutions"
        | "evaluate_and_explain"
        | "explore_current_approaches",
      sourcePreferences: sourcePreferences,
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
});

router.patch("/:sessionId/plans/:planId", async (req, res) => {
  const { sessionId, planId } = req.params;
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
      draft
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
});

router.post("/:sessionId/plans/:planId/approve", async (req, res) => {
  const { sessionId, planId } = req.params;

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
});

export { router as researchRouter };
