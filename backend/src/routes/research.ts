import { Router } from "express";
import {
  approvePlanHandler,
  planResearchHandler,
  startResearchHandler,
  submitClarityHandler,
  updatePlanHandler,
} from "./research/handlers";

const router = Router();

router.post("/start", startResearchHandler);
router.post("/:sessionId/clarity", submitClarityHandler);
router.post("/:sessionId/plan-research", planResearchHandler);
router.patch("/:sessionId/plans/:planId", updatePlanHandler);
router.post("/:sessionId/plans/:planId/approve", approvePlanHandler);

export { router as researchRouter };
