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
  generateResearchPlan,
  storePlanInDatabase,
  type ResearchPlan,
  type PlanningInput,
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

  const userBackground = body.userBackground || "student";
  const researchGoal = (body.researchGoal || "").trim();
  const sourcePreferences = Array.isArray(body.sourcePreferences)
    ? body.sourcePreferences
    : ["reputable_only"];

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

    const clarityRow = clarityResult.rows[0];
    const userBackground = clarityRow.user_background || "student";
    const sourcePreferences: ("research_papers" | "articles_news" | "academic_papers" | "reputable_only")[] =
      clarityRow.source_preferences || ["reputable_only"];
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

export { router as researchRouter };
