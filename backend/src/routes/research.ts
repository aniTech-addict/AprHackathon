import { Router } from "express";
import {
  providerHealthHandler,
  approveReviewParagraphHandler,
  approvePlanHandler,
  deleteReviewParagraphHandler,
  approveReviewPageHandler,
  refineReviewParagraphHandler,
  planResearchHandler,
  reviewExportHandler,
  reviewDraftMarkdownHandler,
  reviewPreviewHandler,
  sourcePreviewHandler,
  startResearchHandler,
  submitClarityHandler,
  updatePlanHandler,
  listSessionsHandler,
} from "./research/handlers";

const router = Router();

router.get("/providers/health", providerHealthHandler);

// Phase 1: Start research session with topic and preferences
router.post("/start", startResearchHandler);

// List all sessions
router.get("/sessions", listSessionsHandler);


router.post("/:sessionId/clarity", submitClarityHandler);
router.post("/:sessionId/plan-research", planResearchHandler);
router.patch("/:sessionId/plans/:planId", updatePlanHandler);
router.post("/:sessionId/plans/:planId/approve", approvePlanHandler);
router.get("/:sessionId/review-preview", reviewPreviewHandler);
router.patch("/:sessionId/review-preview/paragraphs/:paragraphId", refineReviewParagraphHandler);
router.post("/:sessionId/review-preview/paragraphs/:paragraphId/approve", approveReviewParagraphHandler);
router.delete("/:sessionId/review-preview/paragraphs/:paragraphId", deleteReviewParagraphHandler);
router.post("/:sessionId/review-preview/approve", approveReviewPageHandler);
router.get("/:sessionId/review-export", reviewExportHandler);
router.get("/:sessionId/source-preview", sourcePreviewHandler);
router.get("/:sessionId/review-draft-markdown", reviewDraftMarkdownHandler);

export { router as researchRouter };
