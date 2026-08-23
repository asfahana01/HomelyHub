import express from "express";
import dotenv from "dotenv";
 
dotenv.config();
const app = express();
const PORT = process.env.PORT;

//one test route
app.get("/",(req,res)=>{
  res.send("HomelyHub Backend server is running");
}) 
app.listen(PORT, ()=>{
  console.log(`Server is running on port ${PORT}`);
})