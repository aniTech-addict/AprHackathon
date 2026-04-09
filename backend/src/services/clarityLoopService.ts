// when the classification of user input is classified as vauge, is there actually any classfication question being asked?
// it would make sense that we skip it when we are not using llm api , but when we are...
// we do need to ask in loop for clarification questions before moving forward

import { streamJsonChatCompletion } from "./openRouterClient";

export interface ClarityLoopInput {
  topic: string;
  userBackground: "researcher" | "student" | "teacher";
  researchGoal: string;
  sourcePreferences: string[];
  followUpResponses: string[];
  clarityRound: number;
}

export interface ClarityLoopResult {
  nextStep: "ask_clarity_questions" | "generate_research_plan";
  followUpQuestions: string[];
  message: string;
  clarityRound: number;
}

interface LlmClarityResult {
  needsMoreClarification: boolean;
  followUpQuestions: string[];
  reasoning: string;
}

function normalizeQuestions(questions: unknown): string[] {
  if (!Array.isArray(questions)) return [];
  return questions
    .map((question) => String(question || "").trim())
    .filter((question) => question.length > 0)
    .slice(0, 3);
}

async function evaluateWithLlm(
  input: ClarityLoopInput
): Promise<LlmClarityResult | null> {
  const prompt = `Decide whether there is enough information to generate a strong research plan.

Context:
- Topic: ${input.topic}
- User background: ${input.userBackground}
- Research goal: ${input.researchGoal}
- Source preferences: ${input.sourcePreferences.join(", ") || "none"}
- Clarification round: ${input.clarityRound}
- User follow-up responses so far: ${input.followUpResponses.join(" | ") || "none"}

Decision criteria:
- Mark needsMoreClarification=true if key planning details are missing, such as objective precision, scope boundaries, comparison dimension, audience/use-case, or evidence constraints.
- Mark needsMoreClarification=false only if there is enough detail to create focused segments and specific search queries.

Question rules when clarification is needed:
- Ask 1 to 3 highly targeted questions.
- Questions must be answerable in 1 to 2 sentences.
- Do not repeat details already provided in follow-up responses.
- Prefer questions that directly improve plan quality (scope, constraints, deliverable expectations).

Output rules:
- Return strict JSON only with keys: needsMoreClarification, followUpQuestions, reasoning.
- If needsMoreClarification=false, followUpQuestions must be an empty array.
- Keep reasoning concise (max 24 words).`;

  try {
    const result = await streamJsonChatCompletion({
      operation: "clarity-loop",
      model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are a clarity evaluator for a research planning assistant. Follow the user instructions exactly and output strict JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      responseFormat: {
        type: "json_schema",
        jsonSchema: {
          name: "clarity_loop",
          strict: true,
          schema: {
            type: "object",
            properties: {
              needsMoreClarification: { type: "boolean" },
              followUpQuestions: {
                type: "array",
                items: { type: "string" },
              },
              reasoning: { type: "string" },
            },
            required: ["needsMoreClarification", "followUpQuestions", "reasoning"],
            additionalProperties: false,
          },
        },
      },
    });

    if (!result) return null;

    const parsed = JSON.parse(result.content) as {
      needsMoreClarification?: boolean;
      followUpQuestions?: unknown;
      reasoning?: string;
    };

    console.log (parsed.needsMoreClarification);
    
    if (typeof parsed.needsMoreClarification !== "boolean") return null;

    return {
      needsMoreClarification: parsed.needsMoreClarification,
      followUpQuestions: normalizeQuestions(parsed.followUpQuestions),
      reasoning: String(parsed.reasoning || "").trim(),
    };
  } catch (error) {
    console.error("[clarity-loop] OpenRouter clarity evaluation failed; falling back to direct continuation.", error);
    return null;
  }
}

export async function decideClarityNextStep(
  input: ClarityLoopInput
): Promise<ClarityLoopResult> {
  const maxRounds = 3;
  const hasLlm = Boolean(process.env.OPENROUTER_API_KEY);

  if (!hasLlm) {
    console.error("[clarity-loop] OPENROUTER_API_KEY is missing; skipping LLM clarification loop.");
    return {
      nextStep: "generate_research_plan",
      followUpQuestions: [],
      message:
        "Clarity response saved. Proceeding to planning without iterative loop because LLM provider is not configured.",
      clarityRound: input.clarityRound,
    };
  }

  if (input.clarityRound >= maxRounds) {
    return {
      nextStep: "generate_research_plan",
      followUpQuestions: [],
      message: "Maximum clarification rounds reached. Proceeding to planning.",
      clarityRound: input.clarityRound,
    };
  }

  const llmResult = await evaluateWithLlm(input);

  if (llmResult && llmResult.needsMoreClarification && llmResult.followUpQuestions.length > 0) {
    return {
      nextStep: "ask_clarity_questions",
      followUpQuestions: llmResult.followUpQuestions,
      message: llmResult.reasoning || "More clarity is needed before planning.",
      clarityRound: input.clarityRound + 1,
    };
  }

  return {
    nextStep: "generate_research_plan",
    followUpQuestions: [],
    message: "Clarity is sufficient. Proceeding to planning.",
    clarityRound: input.clarityRound,
  };
}
