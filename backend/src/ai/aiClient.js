import Groq from "groq-sdk";
import dotenv from "dotenv"

dotenv.config()

const froq = new Groq({
  apiKey:process.env.GROQ_API_KEY
});

export default Groq;