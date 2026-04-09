/**
 * Classifies user research input as either "descriptive" or "vague" using a heuristic approach and an optional LLM-based classification via the OpenRouter API.
 */

import { streamJsonChatCompletion } from "./openRouterClient";


type InputCategory = "descriptive" | "vague";

interface ClassificationResult {
  category: InputCategory;
  confidence: number;
  reasoning: string;
}

/**
 * Classifies user research input using a heuristic approach based on word count and presence of certain keywords.
 * @param {String} input - User research topic input to classify
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
  const result = await streamJsonChatCompletion({
    operation: "input-classification",
    model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          "You classify research prompts for planning readiness. Label input as 'descriptive' or 'vague'. Descriptive means the input contains clear objective plus at least one useful scope detail (timeframe, geography, audience, comparison, or source constraint). Vague means broad/ambiguous input that still needs clarification. Return strict JSON only matching the provided schema. Keep reasoning concise (max 20 words).",
      },
      {
        role: "user",
        content: `Classify this user input:\n\n${input}`,
      },
    ],
    responseFormat: {
      type: "json_schema",
      jsonSchema: {
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
  });

  if (!result) {
    console.error("[input-classification] OpenRouter returned no result; falling back to heuristics.");
    return null;
  }

  // Validate and parse the respponse and handle errors
  // expected format: {category: "descriptive" | "vague", confidence: number between 0 and 1, reasoning: string}
  try {
    const parsed = JSON.parse(result.content) as ClassificationResult;
    if (
      (parsed.category === "descriptive" || parsed.category === "vague") &&
      typeof parsed.confidence === "number" &&
      typeof parsed.reasoning === "string"
    ) {
      return parsed;
    }
    console.error("[input-classification] OpenRouter returned invalid JSON shape:", result.content);
  } catch (_error) {
    console.error("[input-classification] Failed to parse OpenRouter response:", result.content);
    return null;
  }

  return null;
}

/**
 * 
 * @param {String} input - User research topic input to classify 
 * @returns {Promise<ClassificationResult>} ClassificationResult with category, confidence score and reasoning for classification
 * The function first attempts to classify the input using the OpenRouter API. If the API call fails or returns an invalid response, it falls back to a heuristic classification method based on word count and presence of certain keywords.
 */
export async function classifyInput(input: string): Promise<ClassificationResult> {
  try {
    const llmResult = await classifyWithOpenRouter(input);
    if (llmResult) return llmResult;
  } catch (error) {
    console.error("[input-classification] OpenRouter classification failed; using heuristic fallback:", error);
  }
  
  // if api key is not configured, return heuristic classification result immediately without calling external API
  console.error("[input-classification] Using heuristic classification fallback.");
  return heuristicClassify(input);
}

export type { ClassificationResult, InputCategory };
