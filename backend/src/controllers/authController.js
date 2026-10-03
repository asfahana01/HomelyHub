import {User} from "../Models/userModel.js";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import imagekit from "../utils/ImagekitIO.js";
import {sendMail, forgotPasswordMailGenContent} from "../utils/mail.js";
import {signinToken, createSendToken, defaultAvatarUrl} from "../utils/token.js";


//testing in postman
//signup : create the account

const signup = async(req,res)=>{
  try{
    const newUser = await User.create({
      name:req.body.name,
      email:req.body.email,
      phoneNumber: req.body.phoneNumber,
      password:req.body.password,
      passwordConfirm:req.body.passwordConfirm,
      avatar: {
        url:req.body.avatar || defaultAvatarUrl(req.body.name)}
    })
    createSendToken(newUser,201,res);
  }catch(error){
    const duplicateField = Object.keys(error.keyPattern || {})[0];
    const message = duplicateField ? `An account with that ${duplicateField} already exists` : error.message;
    res.status(400).json({message: error.message})
  }
}

//login : check email +password, then give token
const login = async(req,res)=>{
  try{
    const {email,password} = req.body;
    if(!email || !password){
      throw new Error("Please provide email or password")
  }
  const user = await User.findOne({email}).select("+password")
  if(!user || (await user.correctPassword(password,user.password)) === false){
    throw new Error("Incorrect email or password")
  }
  createSendToken(user,200,res);
}catch(error){
  res.status(401).json({status:"fail", message:error.message})
}
}

// protect
//like middlesware
const protect = async(req,res,next)=>{
  try{
    //step 1: find token 
    // 2 ppl will call this function, one with authorization header and one with cookie
    // 2nd is from the browser
    let token;
    if(req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ){
      token = req.headers.authorization.split(" ")[1]
    }else if(req.cookies.jwt && req.cookies.jwt !=="loggedout"){
      token = req.cookies.jwt;
    }

    //step 2 no token so stop
    if(!token){
    throw new Error("you are not logged in. please login to access this route")

  }

  //step 3: verify token
  const decoded = jwt.verify(token, process.env.JWT_SECRET)

  //step 4: check if user still exists
  const currentUser = await User.findById(decoded.id)
  if(!currentUser){
    throw new Error("the user belonging to the token does't exist")
  };

  //step 5: stolen token, user changed password after the token was issued
  if(currentUser.changedPasswordAfter(decoded.iat)){
    throw new Error("User recently changed the password, please login again")
  }
  // step 6: all checks passed
  req.user = currentUser;
  next();
}
catch(error){
  res.status(401).json({
    status:"fail",
    message:error.message
  })
}
}
export {signup, login, protect}