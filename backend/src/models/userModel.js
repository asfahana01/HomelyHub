//user Schema
import mongoose from "mongoose";
import validator from "validator";
import bcrypt from "bcryptjs";
import crypto from "crypto";
const userSchema = new mongoose.Schema(
  {
    name:{
      type:String,
      required:[true, "Please Enter your Name"],
      //'         john       => 'john
      trim : true,
      maxLength:[20, "Name cannot exceed 20 characters"]
    }
  }
)