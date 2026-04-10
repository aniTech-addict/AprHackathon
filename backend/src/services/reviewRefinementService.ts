import { streamJsonChatCompletion } from "./openRouterClient";
import type { ReviewPreviewParagraph } from "../repositories/reviewPreviewRepository";

export interface RefineParagraphWithAiArgs {
  topic: string;
  segmentTitle: string;
  paragraphContent: string;
  sources: Array<{ title: string; url: string; excerpt: string }>;
  instruction?: string;
}

export async function refineParagraphWithAi(
  args: RefineParagraphWithAiArgs,
): Promise<string | null> {
  const sourceContext = args.sources
    .map((source, index) => {
      return `${index + 1}. ${source.title}\nURL: ${source.url}\nExcerpt: ${source.excerpt}`;
    })
    .join("\n\n");

  const instruction = (args.instruction || "").trim();

  const prompt = `Topic: ${args.topic}
Segment: ${args.segmentTitle}

Current paragraph:
${args.paragraphContent}

Sources:
${sourceContext || "No source context provided."}

Task:
Rewrite this paragraph to improve clarity, factual grounding, and flow.
Do not invent facts.
Keep it to one cohesive paragraph.
${instruction ? `User refinement instruction: ${instruction}` : ""}`;

  const result = await streamJsonChatCompletion({
    operation: "review-ai-refine-paragraph",
    model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are an expert research editor. Improve writing while preserving source-grounded facts. Return strict JSON only.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    responseFormat: {
      type: "json_schema",
      jsonSchema: {
        name: "ai_refined_paragraph",
        strict: true,
        schema: {
          type: "object",
          properties: {
            paragraph: { type: "string" },
          },
          required: ["paragraph"],
          additionalProperties: false,
        },
      },
    },
  });

  if (!result) {
    return null;
  }

  try {
    const parsed = JSON.parse(result.content) as { paragraph?: unknown };
    const paragraph = String(parsed.paragraph || "").trim();
    return paragraph || null;
  } catch {
    return null;
  }
}

export interface StabilizeParagraphFlowArgs {
  topic: string;
  segmentTitle: string;
  previousParagraphContent: string | null;
  nextParagraphContent: string | null;
  previousVersionContent: string | null;
  currentDraft: string;
}

export async function stabilizeParagraphFlow(
  args: StabilizeParagraphFlowArgs,
): Promise<string> {
  const currentDraft = args.currentDraft.trim();
  if (!currentDraft) {
    return args.currentDraft;
  }

  const result = await streamJsonChatCompletion({
    operation: "review-flow-stabilize",
    model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          "You fix local flow inconsistencies in one paragraph while preserving meaning. Return strict JSON only.",
      },
      {
        role: "user",
        content: `Topic: ${args.topic}
Segment: ${args.segmentTitle}

Previous paragraph (if any):
${args.previousParagraphContent || "N/A"}

Current draft:
${currentDraft}

Next paragraph (if any):
${args.nextParagraphContent || "N/A"}

Previous saved version:
${args.previousVersionContent || "N/A"}

Task:
If the current draft has flow issues or abrupt transitions against adjacent paragraphs, return a corrected version.
If no correction is needed, return the current draft unchanged.
Keep one paragraph only.
Return JSON with key \"paragraph\".`,
      },
    ],
    responseFormat: {
      type: "json_schema",
      jsonSchema: {
        name: "flow_stabilized_paragraph",
        strict: true,
        schema: {
          type: "object",
          properties: {
            paragraph: { type: "string" },
          },
          required: ["paragraph"],
          additionalProperties: false,
        },
      },
    },
  });

  if (!result) {
    return currentDraft;
  }

  try {
    const parsed = JSON.parse(result.content) as { paragraph?: unknown };
    const paragraph = String(parsed.paragraph || "").trim();
    return paragraph || currentDraft;
  } catch {
    return currentDraft;
  }
}

export async function harmonizeSegmentFlowWithPrevious(
  topic: string,
  previousPageParagraphs: ReviewPreviewParagraph[],
  currentPageParagraphs: ReviewPreviewParagraph[],
): Promise<Array<{ paragraphId: string; nextContent: string }>> {
  if (previousPageParagraphs.length === 0 || currentPageParagraphs.length === 0) {
    return [];
  }

  const previousTail = previousPageParagraphs[previousPageParagraphs.length - 1];
  const currentHead = currentPageParagraphs[0];

  const result = await streamJsonChatCompletion({
    operation: "review-page-flow-harmonize",
    model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          "You ensure smooth cross-page transition by minimally revising the first paragraph of the current page. Return strict JSON only.",
      },
      {
        role: "user",
        content: `Topic: ${topic}

Previous page final paragraph:
${previousTail.content}

Current page first paragraph:
${currentHead.content}

Task:
If needed, rewrite only the current page first paragraph so the transition from previous page is coherent.
If already coherent, keep it unchanged.
Return JSON with:
{
  "updatedParagraph": "..."
}`,
      },
    ],
    responseFormat: {
      type: "json_schema",
      jsonSchema: {
        name: "harmonized_transition",
        strict: true,
        schema: {
          type: "object",
          properties: {
            updatedParagraph: { type: "string" },
          },
          required: ["updatedParagraph"],
          additionalProperties: false,
        },
      },
    },
  });

  if (!result) {
    return [];
  }

  try {
    const parsed = JSON.parse(result.content) as { updatedParagraph?: unknown };
    const updatedParagraph = String(parsed.updatedParagraph || "").trim();
    if (!updatedParagraph || updatedParagraph === currentHead.content.trim()) {
      return [];
    }

    return [{ paragraphId: currentHead.id, nextContent: updatedParagraph }];
  } catch {
    return [];
  }
}
