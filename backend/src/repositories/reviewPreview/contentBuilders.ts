import type {
  PlanStructureSegment,
  ReviewPreviewParagraph,
  ReviewPreviewSource,
  SourceSeed,
} from "./types";
import { normalizeTrustedUrl } from "./sourceDiscovery";

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

export function buildReviewParagraphContent(
  topic: string,
  segment: PlanStructureSegment,
  paragraphIndex: number,
): string {
  if (paragraphIndex === 1) {
    return `This opening paragraph introduces ${segment.topic} as a focused page in the larger research project on ${topic}. It defines scope, context, and why this page matters for the full document.`;
  }

  if (paragraphIndex === 2) {
    return `This paragraph develops the evidence layer for ${segment.topic}, highlighting data points, competing interpretations, and credible signals that should be validated against the linked sources.`;
  }

  return `This closing paragraph synthesizes implications from ${segment.topic}, connecting the findings back to the research goal on ${topic} and identifying what should inform the next page.`;
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
