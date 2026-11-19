import mongoose from "mongoose";

const authSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const refreshTokenSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, index: true },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    consumedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    replacedByHash: { type: String },
  },
  { timestamps: true }
);

export const AuthSession =
  mongoose.models.AuthSession ||
  mongoose.model("AuthSession", authSessionSchema);
export const RefreshToken =
  mongoose.models.RefreshToken ||
  mongoose.model("RefreshToken", refreshTokenSchema);
