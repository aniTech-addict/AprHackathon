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

interface DetailSignalSummary {
  wordCount: number;
  hasObjectiveSignal: boolean;
  hasScopeSignal: boolean;
  hasConstraintSignal: boolean;
  signalCount: number;
}

function summarizeDetailSignals(input: string): DetailSignalSummary {
  const normalized = input.trim().toLowerCase();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;

  const hasObjectiveSignal =
    /(analy[sz]e|evaluate|compare|assess|investigate|explain|forecast|propose|measure|impact|effect)/.test(
      normalized,
    );
  const hasScopeSignal =
    /(from\s+\d{4}|between\s+\d{4}|\d{4}\s*(to|-|–)\s*\d{4}|in\s+(india|us|usa|europe|africa|asia|global|worldwide)|across|by\s+region|over\s+time|histor)/.test(
      normalized,
    );
  const hasConstraintSignal =
    /(using|based on|with|sources?|papers?|journals?|datasets?|reports?|news|for\s+(students?|researchers?|teachers?)|policy|case studies?|compar)/.test(
      normalized,
    );

  const signalCount = [hasObjectiveSignal, hasScopeSignal, hasConstraintSignal].filter(Boolean)
    .length;

  return {
    wordCount,
    hasObjectiveSignal,
    hasScopeSignal,
    hasConstraintSignal,
    signalCount,
  };
}

function isDescriptiveByStrictRule(input: string): boolean {
  const signals = summarizeDetailSignals(input);

  // Stricter gate: require length and at least two concrete planning signals.
  if (signals.wordCount < 12) {
    return false;
  }

  if (signals.signalCount < 2) {
    return false;
  }

  // At least one of objective/scope should be explicit for planning readiness.
  if (!signals.hasObjectiveSignal && !signals.hasScopeSignal) {
    return false;
  }

  return true;
}

/**
 * Classifies user research input using a heuristic approach based on word count and presence of certain keywords.
 * @param {String} input - User research topic input to classify
 * @returns {Object} category, confidence score and reasoning for classification
 */
function heuristicClassify(input: string): ClassificationResult {
  const normalized = input.trim().toLowerCase();
  const signals = summarizeDetailSignals(input);
  const wordCount = signals.wordCount;

  let score = 0;

  if (wordCount >= 30) score += 0.42;
  else if (wordCount >= 20) score += 0.24;
  else if (wordCount <= 10) score -= 0.42;

  if (signals.hasObjectiveSignal) score += 0.16;

  if (signals.hasScopeSignal) score += 0.16;

  if (signals.hasConstraintSignal) score += 0.12;

  const hasVagueSignal =
    /(^|\s)(something|anything|stuff|topic|about it|etc|help me|tell me about)(\s|$)/.test(
      normalized,
    );
  if (hasVagueSignal) score -= 0.3;

  if (!signals.hasObjectiveSignal) score -= 0.08;
  if (!signals.hasScopeSignal) score -= 0.08;
  if (signals.signalCount < 2) score -= 0.18;

  const category: InputCategory = score >= 0.45 ? "descriptive" : "vague";
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
          "You classify research prompts for planning readiness using a strict standard. Label as 'descriptive' only if the prompt has enough detail to immediately generate focused plan segments and precise search queries. Minimum bar for 'descriptive': explicit objective + at least one scope boundary (timeframe, geography, audience, comparison, or method/source constraint). If details are partial or generic, label 'vague'. Prefer 'vague' when uncertain. Return strict JSON only matching the provided schema. Keep reasoning concise (max 20 words).",
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
    if (llmResult) {
      if (llmResult.category === "descriptive" && !isDescriptiveByStrictRule(input)) {
        return {
          category: "vague",
          confidence: Math.max(0.7, llmResult.confidence),
          reasoning:
            "Input still lacks enough concrete scope/objective constraints for planning; clarification is required.",
        };
      }

      return llmResult;
    }
  } catch (error) {
    console.error("[input-classification] OpenRouter classification failed; using heuristic fallback:", error);
  }
  
  // if api key is not configured, return heuristic classification result immediately without calling external API
  console.error("[input-classification] Using heuristic classification fallback.");
  return heuristicClassify(input);
}

export type { ClassificationResult, InputCategory };
