import mongoose from "mongoose";
import dotenv from "dotenv";
import { User } from "../models/userModel.js";
import { RoleChangeAudit } from "../models/roleChangeAuditModel.js";
import { AdminRoleLock } from "../models/adminRoleLockModel.js";
import { logger } from "../utils/logger.js";

dotenv.config();

const promoteUserToAdmin = async () => {
  const targetEmail = process.argv[2];
  if (!targetEmail) {
    logger.error("admin.bootstrap_usage", {
      usage: "node src/scripts/promoteAdmin.js <user-email>",
    });
    process.exitCode = 1;
    return;
  }

  if (!process.env.MONGO_URI) {
    logger.error("admin.bootstrap_configuration_missing", {
      variable: "MONGO_URI",
    });
    process.exitCode = 1;
    return;
  }

  let session;
  try {
    await mongoose.connect(process.env.MONGO_URI);
    session = await mongoose.startSession();
    let changed = false;
    await session.withTransaction(async () => {
      await AdminRoleLock.updateOne(
        { _id: "admin-role-management" },
        { $inc: { revision: 1 } },
        { upsert: true, session }
      );
      const user = await User.findOne({
        email: targetEmail.toLowerCase().trim(),
      }).select("role").session(session);
      if (!user) throw new Error("Bootstrap user not found");
      if (user.role === "admin") return;

      const updated = await User.findOneAndUpdate(
        { _id: user._id, role: user.role },
        { $set: { role: "admin" } },
        { new: true, runValidators: true, session }
      ).select("_id");
      if (!updated) throw new Error("Bootstrap role changed concurrently");

      await RoleChangeAudit.create(
        [{
          target: user._id,
          previousRole: user.role,
          newRole: "admin",
          requestId: "cli-bootstrap",
          source: "cli_bootstrap",
        }],
        { session }
      );
      changed = true;
    });

    logger.info(
      changed ? "audit.admin_bootstrap_role_changed" : "admin.bootstrap_no_change",
      { source: "cli_bootstrap" }
    );
  } catch (error) {
    logger.error("admin.bootstrap_failed", {
      errorName: error.name || "Error",
    });
    process.exitCode = 1;
  } finally {
    if (session) await session.endSession();
    await mongoose.disconnect();
  }
};

await promoteUserToAdmin();
