import type { ResearchSegment } from "../../services/planningService";

export interface StartResearchBody {
  topic?: string;
  preferredSites?: string[];
}

export interface ClarityBody {
  userBackground?: "researcher" | "student" | "teacher";
  researchGoal?: string;
  sourcePreferences?: (
    | "research_papers"
    | "articles_news"
    | "academic_papers"
    | "reputable_only"
  )[];
  clarityRound?: number;
  followUpResponses?: string[];
}

export interface PlanResearchBody {
  endGoal?: "propose_solutions" | "evaluate_and_explain" | "explore_current_approaches";
}

export interface UpdatePlanBody {
  totalPages?: number;
  segments?: ResearchSegment[];
}

export interface ApproveReviewPageBody {
  planId?: string;
  segmentOrder?: number;
}

export interface ReviewParagraphRefineBody {
  planId?: string;
  mode?: "manual" | "ai";
  content?: string;
  instruction?: string;
}

export interface ReviewParagraphActionBody {
  planId?: string;
}

export type SegmentValidationResult =
  | { ok: true; value: ResearchSegment[] }
  | { ok: false; message: string };
