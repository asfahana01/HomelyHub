import express from "express";
import { getProperties } from "../controllers/propertyController.js";

const propertyRouter = express.Router()
propertyRouter.route("/").get(getProperties)

export{propertyRouter};