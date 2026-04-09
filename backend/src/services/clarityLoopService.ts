// when the classification of user input is classified as vauge, is there actually any classfication question being asked?
// it would make sense that we skip it when we are not using llm api , but when we are...
// we do need to ask in loop for clarification questions before moving forward

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
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

  const prompt = `Determine if the user has provided enough clarity to generate a research plan.

Topic: ${input.topic}
User Background: ${input.userBackground}
Research Goal: ${input.researchGoal}
Source Preferences: ${input.sourcePreferences.join(", ")}
Clarity Round: ${input.clarityRound}
Follow-up Responses: ${input.followUpResponses.join(" | ") || "none"}

Rules:
- If details are still vague, return needsMoreClarification=true and provide 1 to 3 targeted questions.
- Questions must be concrete and answerable in 1-2 sentences.
- If clarity is enough, return needsMoreClarification=false and no questions.
- Keep questions specific to planning quality.

Return strict JSON only with:
{
  "needsMoreClarification": boolean,
  "followUpQuestions": string[],
  "reasoning": string
}`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://web-researcher-agent.local",
        "X-Title": "Web Researcher Agent",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You evaluate research intent clarity. Return JSON only, no markdown.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as {
      needsMoreClarification?: boolean;
      followUpQuestions?: unknown;
      reasoning?: string;
    };

    if (typeof parsed.needsMoreClarification !== "boolean") return null;

    return {
      needsMoreClarification: parsed.needsMoreClarification,
      followUpQuestions: normalizeQuestions(parsed.followUpQuestions),
      reasoning: String(parsed.reasoning || "").trim(),
    };
  } catch (_error) {
    return null;
  }
}

export async function decideClarityNextStep(
  input: ClarityLoopInput
): Promise<ClarityLoopResult> {
  const maxRounds = 3;
  const hasLlm = Boolean(process.env.OPENROUTER_API_KEY);

  if (!hasLlm) {
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
