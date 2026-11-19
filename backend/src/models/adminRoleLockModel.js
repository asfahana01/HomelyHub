import mongoose from "mongoose";

const adminRoleLockSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "admin-role-management" },
    revision: { type: Number, default: 0 },
  },
  { versionKey: false }
);

export const AdminRoleLock =
  mongoose.models.AdminRoleLock ||
  mongoose.model("AdminRoleLock", adminRoleLockSchema);
