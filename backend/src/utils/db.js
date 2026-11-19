import mongoose from "mongoose";
import { logger } from "./logger.js";

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    logger.info("database.connected", {});
  } catch (error) {
    logger.error("database.connection_failed", {
      errorName: error.name || "Error",
    });
    throw error;
  }
};

export default connectDB;