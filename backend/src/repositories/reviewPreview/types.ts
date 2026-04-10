export interface PlanStructureSegment {
  order: number;
  title: string;
  topic: string;
}

export interface ReviewPreviewSource {
  id: string;
  title: string;
  url: string;
  excerpt: string;
}

export type ReviewParagraphStatus =
  | "pending_review"
  | "approved"
  | "deleted";

export interface ReviewPreviewParagraph {
  id: string;
  order: number;
  segmentOrder: number;
  paragraphIndex: number;
  segmentTitle: string;
  content: string;
  previousContent: string | null;
  status: ReviewParagraphStatus;
  lastEditedBy: "manual" | "ai" | null;
  sources: ReviewPreviewSource[];
}

export interface ReviewPreviewPage {
  segmentOrder: number;
  segmentTitle: string;
  topic: string;
  paragraphs: ReviewPreviewParagraph[];
}

export interface EnsureReviewPreviewArgs {
  sessionId: string;
  planId: string;
  topic: string;
  researchFocusContext?: string;
  relevanceThreshold?: number;
  segments: PlanStructureSegment[];
}

export interface ReviewParagraphRow {
  id: string;
  paragraph_order: number;
  segment_order: number;
  paragraph_index: number;
  segment_title: string;
  content: string;
  previous_content: string | null;
  status: ReviewParagraphStatus;
  last_edited_by: "manual" | "ai" | null;
}

export interface ReviewSourceRow {
  id: string;
  paragraph_id: string;
  title: string;
  url: string;
  excerpt: string;
}

export interface ReviewPageProgress {
  approvedSegmentOrders: number[];
  generatedSegmentOrders: number[];
}

export interface SourceSeed {
  title: string;
  url: string;
  excerpt: string;
}

export interface CandidateSource {
  title: string;
  url: string;
  excerpt: string;
}
