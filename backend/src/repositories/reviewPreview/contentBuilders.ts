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
  allSegments: PlanStructureSegment[] = [],
  previousParagraphContent: string = "",
): string {
  // Get the current segment's title for context
  const segmentTitle = segment.title;
  
  if (paragraphIndex === 1) {
    // Opening paragraph: Introduce the segment topic and its relation to the overall topic
    return `This opening paragraph introduces ${segment}` as a focused page in the larger research project on ${topic}. It defines scope, context, and why this page matters for the full document. Building upon the foundation established in previous sections, this page explores how ${segmentTitle.toLowerCase()} contributes to our understanding of ${topic}.`;
  }

  if (paragraphIndex === 2) {
    // Middle paragraph: Develop evidence with explicit connection to opening paragraph
    const evidenceConnection = previousParagraphContent 
      ? `Following the contextual framework established in the opening discussion of ${segmentTitle.toLowerCase()}, `
      : `This section examines the evidence surrounding ${segmentTitle.toLowerCase()}, `;
    
    return `${evidenceConnection}this paragraph develops the evidence layer for ${segmentTitle}, highlighting data points, competing interpretations, and credible signals that should be validated against the linked sources. The analysis builds directly on the introductory concepts to provide substantive support for the claims presented.`;
  }

  // Closing paragraph: Synthesize implications with connections to both previous paragraphs
  const synthesisFoundation = previousParagraphContent 
    ? `Synthesizing the insights from both the contextual introduction and evidence analysis of ${segmentTitle.toLowerCase()}, `
    : `Having established the context and evidence for ${segmentTitle.toLowerCase()}, `;
    
  return `${synthesisFoundation}this closing paragraph synthesizes implications from ${segmentTitle}, connecting the findings back to the research goal on ${topic} and identifying what should inform the next page. The conclusions drawn here emerge naturally from the preceding discussion and establish clear pathways for continued exploration in subsequent sections.`;
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
