import express from "express";

import {
  check,
  forgotPassword,
  login,
  logout,
  protect,
  restrictTo,
  resetPassword,
  signup,
  updateMe,
  updatePassword,
} from "../controllers/authController.js";
import { createTripPlan } from "../controllers/tripController.js";
import {
  createProperty,
  getUsersProperties,
} from "../controllers/propertyController.js";
import { generatePropertyDescription } from "../controllers/aiController.js";
import { authLimiter, aiLimiter } from "../utils/security.js";

const router = express.Router();

router.route("/signup").post(authLimiter, signup);
router.route("/login").post(authLimiter, login);
router.route("/logout").get(logout);
router.route("/updateMe").patch(protect, updateMe);
router.route("/updateMyPassword").patch(protect, updatePassword);
router.route("/forgotPassword").post(authLimiter, forgotPassword);
router.route("/resetPassword/:token").patch(authLimiter, resetPassword);
router.route("/me").get(protect, check);
router.route("/createTripPlan").post(protect, aiLimiter, createTripPlan);

// Admin-only property accommodation endpoints (RBAC)
router.route("/newAccommodation").post(protect, restrictTo("admin"), createProperty);
router.route("/myAccommodation").get(protect, restrictTo("admin"), getUsersProperties);

// AI description generation is an admin feature for creating properties
router
  .route("/generateDescription")
  .post(protect, restrictTo("admin"), aiLimiter, generatePropertyDescription);

export { router };
