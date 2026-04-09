import { Router } from "express";
import { randomUUID } from "crypto";
import { classifyInput } from "../services/inputClassifier";
import { createSession } from "../repositories/sessionRepository";

interface StartResearchBody {
  topic?: string;
  preferredSites?: string[];
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

export { router as researchRouter };
