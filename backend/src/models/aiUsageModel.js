import mongoose from "mongoose";

const aiUsageSchema = new mongoose.Schema(
  {
    _id: { type: String },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    dayKey: { type: String, required: true },
    tokensReserved: { type: Number, required: true, default: 0 },
    requests: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

export const AiUsage =
  mongoose.models.AiUsage || mongoose.model("AiUsage", aiUsageSchema);
