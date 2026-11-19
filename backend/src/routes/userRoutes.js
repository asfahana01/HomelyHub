import express from "express";

import {
  check,
  forgotPassword,
  login,
  logout,
  refreshAccessToken,
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
import { requestSchemas, validateRequest } from "../utils/validation.js";
import { aiUsageLimiter } from "../services/aiUsageService.js";
import {
  listAdminUsers,
  updateUserRole,
} from "../controllers/adminUserController.js";

const router = express.Router();

router.route("/signup").post(authLimiter, validateRequest(requestSchemas.signup), signup);
router.route("/login").post(authLimiter, validateRequest(requestSchemas.login), login);
router.route("/logout").get(
  validateRequest(requestSchemas.emptyQuery, "query"),
  logout
).post(
    validateRequest(requestSchemas.emptyBody),
    logout
  );
router.route("/refresh-token").post(
  validateRequest(requestSchemas.emptyBody),
  refreshAccessToken
);
router.route("/updateMe").patch(
  protect,
  validateRequest(requestSchemas.profile),
  updateMe
);
router.route("/updateMyPassword").patch(
  protect,
  validateRequest(requestSchemas.updatePassword),
  updatePassword
);
router.route("/forgotPassword").post(
  authLimiter,
  validateRequest(requestSchemas.forgotPassword),
  forgotPassword
);
router.route("/resetPassword/:token").patch(
  authLimiter,
  validateRequest(requestSchemas.tokenParam, "params"),
  validateRequest(requestSchemas.resetPassword),
  resetPassword
);
router.route("/me").get(protect, check);
router.route("/admin/users").get(
  protect,
  restrictTo("admin"),
  validateRequest(requestSchemas.adminUserList, "query"),
  listAdminUsers
);
router.route("/admin/users/:userId/role").patch(
  protect,
  restrictTo("admin"),
  validateRequest(requestSchemas.adminUserIdParam, "params"),
  validateRequest(requestSchemas.updateUserRole),
  updateUserRole
);
router.route("/createTripPlan").post(
  protect,
  aiLimiter,
  validateRequest(requestSchemas.tripPlan),
  aiUsageLimiter(2000),
  createTripPlan
);

// Admin-only property accommodation endpoints (RBAC)
router.route("/newAccommodation").post(
  protect,
  restrictTo("admin"),
  validateRequest(requestSchemas.createProperty),
  createProperty
);
router.route("/myAccommodation").get(protect, restrictTo("admin"), getUsersProperties);

// AI description generation is an admin feature for creating properties
router
  .route("/generateDescription")
  .post(
    protect,
    restrictTo("admin"),
    aiLimiter,
    validateRequest(requestSchemas.propertyDescription),
    aiUsageLimiter(500),
    generatePropertyDescription
  );

export { router };
