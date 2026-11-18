import express from "express";
import {
  getProperties,
  getProperty,
  createProperty,
  updateProperty,
  deleteProperty,
} from "../controllers/propertyController.js";
import { protect, restrictTo } from "../controllers/authController.js";

const propertyRouter = express.Router();

// Public routes
propertyRouter.route("/").get(getProperties);
propertyRouter.route("/:id").get(getProperty);

// Admin-only management routes (RBAC)
propertyRouter.route("/").post(protect, restrictTo("admin"), createProperty);
propertyRouter.route("/:id").patch(protect, restrictTo("admin"), updateProperty);
propertyRouter.route("/:id").delete(protect, restrictTo("admin"), deleteProperty);

export { propertyRouter };
