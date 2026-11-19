import express from "express";
import { createTripPlan } from "../controllers/tripController.js";
import { protect } from "../controllers/authController.js";
import { aiLimiter } from "../utils/security.js";
import { requestSchemas, validateRequest } from "../utils/validation.js";
import { aiUsageLimiter } from "../services/aiUsageService.js";

const tripRouter = express.Router();

// Private AI trip planning route protected by authentication and rate limiting
tripRouter.route("/").post(
  protect,
  aiLimiter,
  validateRequest(requestSchemas.tripPlan),
  aiUsageLimiter(2000),
  createTripPlan
);

export { tripRouter };
