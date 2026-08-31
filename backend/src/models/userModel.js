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
    },
    email:{
      type:String,
      required:[true, "Please Enter your Email"],
      unique:true,
      lowercase:true,
      trim:true,
      validate:[validator.isEmail, "Please Enter a valid Email"]
    },
    password:{
      type:String,
      required:[true, "Please Enter your Password"],
      minLength:[6, "Password should be greater or equal to 6 characters"],
      select:false
    },
    passwordConfirm:{
      type:String,
      required:[true, "Please Confirm your Password"],
      validate:{
        validator:function(el){
          return el === this.password;
        },
        message:"Password does not match"
    }
  },
  phoneNumber:{
    type:String,
    required: true,
    unique: true,
    trim:true
  },
  role:{
    type:String,
    enum:["user", "admin"],
    default:"user"
  },
  avatar:{
    url:{type:String},
    public_id:{type:String}
  },
  passwordChangedAt:{
    type:Date
  },
  passwordResetToken:{
    type:String,
    select:false,
    index:true
  },
  passwordResetExpires:{
    type:Date,
    select:false,
  },
},
{timestamps:true}
)