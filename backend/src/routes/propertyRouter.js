
import express from "express";
import {
  getProperties,
  getProperty
} from "../controllers/propertyController.js";

const propertyRouter = express.Router();

// Get all properties
propertyRouter.route("/").get(getProperties);

// Get one property using its ID
propertyRouter.route("/:id").get(getProperty);

export { propertyRouter };
