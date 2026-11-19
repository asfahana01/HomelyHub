import express from "express";
import {
  getProperties,
  getProperty,
  createProperty,
  updateProperty,
  deleteProperty,
} from "../controllers/propertyController.js";
import { protect, restrictTo } from "../controllers/authController.js";
import { requestSchemas, validateRequest } from "../utils/validation.js";

const propertyRouter = express.Router();

// Public routes
propertyRouter.route("/").get(getProperties);
propertyRouter.route("/:id").get(
  validateRequest(requestSchemas.propertyIdParam, "params"),
  getProperty
);

// Admin-only management routes (RBAC)
propertyRouter.route("/").post(
  protect,
  restrictTo("admin"),
  validateRequest(requestSchemas.createProperty),
  createProperty
);
propertyRouter.route("/:id").patch(
  protect,
  restrictTo("admin"),
  validateRequest(requestSchemas.propertyIdParam, "params"),
  validateRequest(requestSchemas.updateProperty),
  updateProperty
);
propertyRouter.route("/:id").delete(
  protect,
  restrictTo("admin"),
  validateRequest(requestSchemas.propertyIdParam, "params"),
  validateRequest(requestSchemas.emptyBody),
  deleteProperty
);

export { propertyRouter };
