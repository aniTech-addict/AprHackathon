import type {
  PlanStructureSegment,
  ReviewPreviewParagraph,
  ReviewPreviewSource,
  SourceSeed,
} from "./types";
import { normalizeTrustedUrl } from "./sourceDiscovery";
import { streamJsonChatCompletion } from "../../services/openRouterClient";

function buildTemplateParagraph(
  topic: string,
  segment: PlanStructureSegment,
  paragraphIndex: number,
  previousParagraphs: string[],
): string {
  const transition =
    paragraphIndex === 1
      ? ""
      : paragraphIndex === 2
        ? "Building on the framing above, "
        : "Taken together with the earlier evidence, ";

  if (paragraphIndex === 1) {
    return `This section examines ${segment.topic} within the broader research topic of ${topic}. It establishes core terms, scope, and why this segment matters for understanding the full picture before moving into evidence and interpretation.`;
  }

  if (paragraphIndex === 2) {
    return `${transition}this paragraph focuses on the strongest available evidence about ${segment.topic}, highlighting where findings align, where they conflict, and which claims should be treated with caution based on source quality.`;
  }

  const hasContext = previousParagraphs.length > 0;
  return `${transition}this section closes by synthesizing implications from ${segment.topic} for the wider question on ${topic}, outlining what appears well-supported and what should be investigated further${hasContext ? " in the next segment" : ""}.`;
}

function parseGeneratedParagraph(jsonText: string): string | null {
  try {
    const parsed = JSON.parse(jsonText) as { paragraph?: unknown };
    const paragraph = String(parsed.paragraph || "").trim();
    return paragraph || null;
  } catch {
    return null;
  }
}

function parseHarmonizedParagraphs(jsonText: string): string[] | null {
  try {
    const parsed = JSON.parse(jsonText) as { paragraphs?: unknown };
    if (!Array.isArray(parsed.paragraphs)) {
      return null;
    }

    const paragraphs = parsed.paragraphs
      .map((value) => String(value || "").trim())
      .filter((value) => value.length > 0);

    return paragraphs.length === 3 ? paragraphs : null;
  } catch {
    return null;
  }
}

export function hasStrictValidSources(paragraphs: ReviewPreviewParagraph[]): boolean {
  if (paragraphs.length === 0) {
    return false;
  }

  for (const paragraph of paragraphs) {
    if (paragraph.sources.length === 0) {
      return false;
    }

    for (const source of paragraph.sources) {
      if (!normalizeTrustedUrl(source.url)) {
        return false;
      }
    }
  }

  return true;
}

export async function buildReviewParagraphContent(
  topic: string,
  segment: PlanStructureSegment,
  paragraphIndex: number,
  previousParagraphs: string[] = [],
  sources: SourceSeed[] = [],
  researchFocusContext = "",
): Promise<string> {
  if (paragraphIndex < 1 || paragraphIndex > 3) {
    return buildTemplateParagraph(topic, segment, 3, previousParagraphs);
  }

  const contextPrompt = previousParagraphs.length > 0
    ? `Previous paragraphs in this section:\n${previousParagraphs.map((p, i) => `${i + 1}. ${p}`).join("\n\n")}\n\n`
    : "";

  const rolePrompt = paragraphIndex === 1
    ? "Write an opening paragraph that introduces this section's topic and sets up the discussion."
    : paragraphIndex === 2
      ? "Write a middle paragraph that develops the evidence and analysis, building on the previous paragraph."
      : "Write a concluding paragraph that synthesizes the findings and connects back to the broader research topic.";

  const focusContextPrompt = researchFocusContext.trim()
    ? `Research focus context from phases 1-3:\n${researchFocusContext.trim()}\n\n`
    : "";

  const prompt = `Topic: ${topic}\nSection: ${segment.title}\nParagraph position in this section: ${paragraphIndex} of 3\n\n${focusContextPrompt}${contextPrompt}${rolePrompt}\n\nRequirements:\n- Continue the narrative, do not write as an isolated standalone paragraph.\n- If this is paragraph 2 or 3, use a natural transition from what was said before.\n- Add new information rather than repeating earlier sentences.\n- Use only source-grounded claims.\n- Stay tightly scoped to this section and the research focus context above.\n- Do not drift into adjacent topics unless directly required for this section's analysis.\n\nSources:\n${sources.map((s, i) => `${i + 1}. ${s.title}: ${s.excerpt}`).join("\n")}`;

  const result = await streamJsonChatCompletion({
    operation: "generate-paragraph",
    model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: "You are an expert research writer. Generate a cohesive paragraph based on the provided context and sources. Return strict JSON only.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    responseFormat: {
      type: "json_schema",
      jsonSchema: {
        name: "generated_paragraph",
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
    return buildTemplateParagraph(topic, segment, paragraphIndex, previousParagraphs);
  }

  const generated = parseGeneratedParagraph(result.content);
  if (!generated) {
    return buildTemplateParagraph(topic, segment, paragraphIndex, previousParagraphs);
  }

  return generated;
}

export async function harmonizeSegmentParagraphs(args: {
  topic: string;
  segment: PlanStructureSegment;
  paragraphs: string[];
  sources: SourceSeed[];
  researchFocusContext?: string;
}): Promise<string[]> {
  if (args.paragraphs.length !== 3 || args.paragraphs.some((value) => !value.trim())) {
    return args.paragraphs;
  }

  const sourceContext = args.sources
    .map((source, index) => `${index + 1}. ${source.title}\nURL: ${source.url}\nExcerpt: ${source.excerpt}`)
    .join("\n\n");

  const focusContextPrompt = args.researchFocusContext?.trim()
    ? `Research focus context from phases 1-3:\n${args.researchFocusContext.trim()}\n\n`
    : "";

  const prompt = `Topic: ${args.topic}
Section: ${args.segment.title}

${focusContextPrompt}Current 3-paragraph draft:
1) ${args.paragraphs[0]}

2) ${args.paragraphs[1]}

3) ${args.paragraphs[2]}

Sources:
${sourceContext || "No sources provided."}

Task:
Rewrite this three-paragraph section so it reads like one connected narrative.
Requirements:
- Keep exactly 3 paragraphs in the same opening/evidence/synthesis structure.
- Preserve factual meaning and only use source-grounded claims.
- Improve transitions between paragraph 1->2 and 2->3.
- Reduce repetition across the three paragraphs.
- Keep each paragraph as a single paragraph block.
- Maintain strict alignment with the section scope and research focus context.
- Rewrite any sentence that drifts from the section's core question.

Return strict JSON with key "paragraphs" as an array of 3 strings.`;

  const result = await streamJsonChatCompletion({
    operation: "harmonize-segment-paragraphs",
    model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          "You are an expert research editor. Improve cross-paragraph coherence while preserving meaning. Return strict JSON only.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    responseFormat: {
      type: "json_schema",
      jsonSchema: {
        name: "harmonized_segment_paragraphs",
        strict: true,
        schema: {
          type: "object",
          properties: {
            paragraphs: {
              type: "array",
              items: { type: "string" },
              minItems: 3,
              maxItems: 3,
            },
          },
          required: ["paragraphs"],
          additionalProperties: false,
        },
      },
    },
  });

  if (!result) {
    return args.paragraphs;
  }

  const harmonized = parseHarmonizedParagraphs(result.content);
  return harmonized || args.paragraphs;
}

export function buildReviewSourcesForParagraph(
  segment: PlanStructureSegment,
  paragraphIndex: number,
  sourcePool: SourceSeed[],
): Array<Omit<ReviewPreviewSource, "id">> {
  return sourcePool.map((source) => ({
    title: `${segment.title}: ${source.title}`,
    url: source.url,
    excerpt:
      paragraphIndex === 1
        ? `${source.excerpt} Prioritize this source for framing and terminology.`
        : paragraphIndex === 2
          ? `${source.excerpt} Prioritize this source for evidence and claims validation.`
          : `${source.excerpt} Prioritize this source for synthesis and implications.`,
  }));
}

export function getParagraphOrder(segmentOrder: number, paragraphIndex: number): number {
  return (segmentOrder - 1) * 3 + paragraphIndex;
}

export function getNextSegmentToGenerate(
  segments: PlanStructureSegment[],
  approvedSegmentOrders: number[],
  generatedSegmentOrders: number[],
): PlanStructureSegment | null {
  const expectedNextOrder = approvedSegmentOrders.length + 1;
  const nextSegment = segments.find((segment) => segment.order === expectedNextOrder) || null;

  if (!nextSegment) {
    return null;
  }

  if (generatedSegmentOrders.includes(nextSegment.order)) {
    return null;
  }

  return nextSegment;
}
