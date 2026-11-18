import mongoose from "mongoose";
import dotenv from "dotenv";
import { User } from "../models/userModel.js";

dotenv.config();

const promoteUserToAdmin = async () => {
  const targetEmail = process.argv[2];

  if (!targetEmail) {
    console.error("Usage: node src/scripts/promoteAdmin.js <user-email>");
    process.exit(1);
  }

  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set in environment variables");
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    const user = await User.findOne({ email: targetEmail.toLowerCase().trim() });
    if (!user) {
      console.error(`User with email "${targetEmail}" not found.`);
      process.exit(1);
    }

    user.role = "admin";
    await user.save({ validateBeforeSave: false });

    console.log(`[AUDIT] Successfully promoted "${user.email}" (ID: ${user._id}) to "admin".`);
    process.exit(0);
  } catch (error) {
    console.error("Failed to promote user to admin:", error.message);
    process.exit(1);
  }
};

promoteUserToAdmin();
