import { Router } from "express";
import {
  approvePlanHandler,
  approveReviewPageHandler,
  planResearchHandler,
  reviewExportHandler,
  reviewPreviewHandler,
  startResearchHandler,
  submitClarityHandler,
  updatePlanHandler,
} from "./research/handlers";

const router = Router();

// Phase 1: Start research session with topic and preferences
router.post("/start", startResearchHandler);


router.post("/:sessionId/clarity", submitClarityHandler);
router.post("/:sessionId/plan-research", planResearchHandler);
router.patch("/:sessionId/plans/:planId", updatePlanHandler);
router.post("/:sessionId/plans/:planId/approve", approvePlanHandler);
router.get("/:sessionId/review-preview", reviewPreviewHandler);
router.post("/:sessionId/review-preview/approve", approveReviewPageHandler);
router.get("/:sessionId/review-export", reviewExportHandler);

export { router as researchRouter };
