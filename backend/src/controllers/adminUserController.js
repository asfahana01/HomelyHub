import mongoose from "mongoose";
import { User } from "../models/userModel.js";
import { RoleChangeAudit } from "../models/roleChangeAuditModel.js";
import { AdminRoleLock } from "../models/adminRoleLockModel.js";
import { AppError } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";

const isTransactionUnavailable = (error) =>
  error?.code === 20 ||
  /transactions are not supported|replica set|transaction numbers are only allowed/i.test(
    error?.message || ""
  );

export const listAdminUsers = async (req, res, next) => {
  try {
    const { page, limit } = req.validated.query;
    const [users, total] = await Promise.all([
      User.find()
        .select("name email role createdAt")
        .sort({ createdAt: -1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(),
    ]);

    res.status(200).json({
      status: "success",
      data: {
        users,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateUserRole = async (req, res, next) => {
  const { userId } = req.params;
  const { role } = req.body;
  if (
    String(req.user._id).toLowerCase() === userId.toLowerCase() &&
    role !== "admin"
  ) {
    return next(new AppError(409, "Administrators cannot demote their own account."));
  }

  const session = await mongoose.startSession();
  try {
    let updatedUser;
    let previousRole;
    await session.withTransaction(async () => {
      updatedUser = undefined;
      previousRole = undefined;
      await AdminRoleLock.updateOne(
        { _id: "admin-role-management" },
        { $inc: { revision: 1 } },
        { upsert: true, session }
      );
      const target = await User.findById(userId)
        .select("role")
        .session(session);
      if (!target) throw new AppError(404, "User not found");
      if (target.role === role) {
        updatedUser = await User.findById(userId)
          .select("name email role createdAt")
          .session(session);
        return;
      }
      previousRole = target.role;

      if (target.role === "admin" && role === "user") {
        const adminCount = await User.countDocuments({ role: "admin" }).session(
          session
        );
        if (adminCount <= 1) {
          throw new AppError(409, "The last administrator cannot be demoted.");
        }
      }

      updatedUser = await User.findOneAndUpdate(
        { _id: userId, role: target.role },
        { $set: { role } },
        { new: true, runValidators: true, session }
      ).select("name email role createdAt");
      if (!updatedUser) throw new AppError(409, "User role changed concurrently");

      await RoleChangeAudit.create(
        [{
          actor: req.user._id,
          target: userId,
          previousRole: target.role,
          newRole: role,
          requestId: req.requestId || "unavailable",
          source: "admin_api",
        }],
        { session }
      );
    });

    if (previousRole) {
      logger.info("audit.user_role_changed", {
        requestId: req.requestId,
        actorId: String(req.user._id),
        targetId: userId,
        previousRole,
        newRole: role,
      });
    }

    res.status(200).json({
      status: "success",
      data: { user: updatedUser },
    });
  } catch (error) {
    if (isTransactionUnavailable(error)) {
      return next(
        new AppError(
          503,
          "Role management requires MongoDB transaction support."
        )
      );
    }
    next(error);
  } finally {
    await session.endSession();
  }
};
