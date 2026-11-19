import mongoose from "mongoose";

const roleChangeAuditSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    target: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    previousRole: {
      type: String,
      enum: ["user", "admin"],
      required: true,
    },
    newRole: {
      type: String,
      enum: ["user", "admin"],
      required: true,
    },
    requestId: { type: String, required: true },
    source: {
      type: String,
      enum: ["admin_api", "cli_bootstrap"],
      required: true,
    },
  },
  { timestamps: true }
);

roleChangeAuditSchema.index({ target: 1, createdAt: -1 });
roleChangeAuditSchema.index({ actor: 1, createdAt: -1 });

export const RoleChangeAudit =
  mongoose.models.RoleChangeAudit ||
  mongoose.model("RoleChangeAudit", roleChangeAuditSchema);
