/**
 * Classifies user research input as either "descriptive" or "vague" using a heuristic approach and an optional LLM-based classification via the OpenRouter API.
 */


type InputCategory = "descriptive" | "vague";

interface ClassificationResult {
  category: InputCategory;
  confidence: number;
  reasoning: string;
}

/**
 * 
 * @param {String} input: approximated score of context provided by user for research topic based 
 * on input word count, goal, scope, source signal
 * score above 0.3 is classified as descriptive, below 0.3 is classified as vague
 * @returns {Object} category, confidence score and reasoning for classification
 */
function heuristicClassify(input: string): ClassificationResult {
  const normalized = input.trim().toLowerCase();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;

  let score = 0;

  if (wordCount >= 25) score += 0.45;
  else if (wordCount >= 15) score += 0.28;
  else if (wordCount <= 6) score -= 0.35;

  const hasGoalSignal = /(goal|focus|compare|evaluate|analyze|history|future|solution|impact)/.test(normalized);
  if (hasGoalSignal) score += 0.22;

  const hasScopeSignal = /(in|for|between|across|from .* to .*|current|global|india|us|europe|africa)/.test(normalized);
  if (hasScopeSignal) score += 0.15;

  const hasSourceSignal = /(source|paper|journal|news|report|dataset|article)/.test(normalized);
  if (hasSourceSignal) score += 0.12;

  const hasVagueSignal = /(^|\s)(something|anything|stuff|topic|about it|etc)(\s|$)/.test(normalized);
  if (hasVagueSignal) score -= 0.3;

  const category: InputCategory = score >= 0.3 ? "descriptive" : "vague";
  const confidence = Math.max(0.55, Math.min(0.95, 0.65 + Math.abs(score) * 0.4));

  return {
    category,
    confidence,
    reasoning:
      category === "descriptive"
        ? "Input includes enough scope or intent to begin planning."
        : "Input lacks sufficient scope/intent details and needs clarification.",
  };
}

/**
 * Classifies user research input using the OpenRouter API
 * @param {String} input - User research topic input to classify
 * @returns {Promise<ClassificationResult | null>} ClassificationResult or null if API call fails or returns invalid response 
 */
async function classifyWithOpenRouter(input: string): Promise<ClassificationResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

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
            "Classify user research input as descriptive or vague. Return strict JSON with keys: category, confidence, reasoning.",
        },
        {
          role: "user",
          content: input,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "input_category",
          strict: true,
          schema: {
            type: "object",
            properties: {
              category: { type: "string", enum: ["descriptive", "vague"] },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              reasoning: { type: "string" },
            },
            required: ["category", "confidence", "reasoning"],
            additionalProperties: false,
          },
        },
      },
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as ClassificationResult;
    if (
      (parsed.category === "descriptive" || parsed.category === "vague") &&
      typeof parsed.confidence === "number" &&
      typeof parsed.reasoning === "string"
    ) {
      return parsed;
    }
  } catch (_error) {
    return null;
  }

  return null;
}

/**
 * 
 * @param {String} 
 * @returns 
 */
export async function classifyInput(input: string): Promise<ClassificationResult> {
  try {
    const llmResult = await classifyWithOpenRouter(input);
    if (llmResult) return llmResult;
  } catch (_error) {
    // Fallback is intentional for local development without external providers.
  }
  
  // if api key is not configured, return heuristic classification result immediately without calling external API
  return heuristicClassify(input);
}

export type { ClassificationResult, InputCategory };
