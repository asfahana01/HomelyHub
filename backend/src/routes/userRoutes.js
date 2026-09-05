//address list
import express from "express";
import {signup, login} from "../controllers/authController.js";

const router = express.Router();

//endpoints
router.route("/signup").post(signup);
router.route("/login").post(login);

export {router}