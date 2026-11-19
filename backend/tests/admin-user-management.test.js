import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { User } from "../src/models/userModel.js";
import { RoleChangeAudit } from "../src/models/roleChangeAuditModel.js";
import { AdminRoleLock } from "../src/models/adminRoleLockModel.js";
import { updateUserRole } from "../src/controllers/adminUserController.js";

const actorId = "64b7f123456789abcdef0789";
const targetId = "64b7f123456789abcdef0123";

const fakeSession = () => ({
  async withTransaction(callback) {
    await callback();
  },
  async endSession() {},
});

const response = () => ({
  statusCode: null,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

describe("admin user role management", () => {
  test("records role changes in the same transaction as the update", async (t) => {
    const target = { role: "user" };
    const updatedUser = { _id: targetId, role: "admin" };
    const session = fakeSession();
    let auditRows;
    t.mock.method(mongoose, "startSession", async () => session);
    t.mock.method(AdminRoleLock, "updateOne", async () => ({ matchedCount: 1 }));
    t.mock.method(User, "findById", () => ({
      select: () => ({ session: async () => target }),
    }));
    t.mock.method(User, "findOneAndUpdate", () => ({
      select: async () => updatedUser,
    }));
    t.mock.method(RoleChangeAudit, "create", async (rows, options) => {
      auditRows = { rows, options };
      return rows;
    });

    const res = response();
    await updateUserRole(
      {
        params: { userId: targetId },
        body: { role: "admin" },
        user: { _id: actorId },
        requestId: "request-role-change",
      },
      res,
      (error) => {
        throw error;
      }
    );

    assert.equal(res.statusCode, 200);
    assert.equal(auditRows.rows[0].actor, actorId);
    assert.equal(auditRows.rows[0].target, targetId);
    assert.equal(auditRows.rows[0].previousRole, "user");
    assert.equal(auditRows.rows[0].newRole, "admin");
    assert.equal(auditRows.options.session, session);
  });

  test("does not allow the last administrator to be demoted", async (t) => {
    const session = fakeSession();
    let responseError;
    t.mock.method(mongoose, "startSession", async () => session);
    t.mock.method(AdminRoleLock, "updateOne", async () => ({ matchedCount: 1 }));
    t.mock.method(User, "findById", () => ({
      select: () => ({ session: async () => ({ role: "admin" }) }),
    }));
    t.mock.method(User, "countDocuments", () => ({
      session: async () => 1,
    }));
    t.mock.method(User, "findOneAndUpdate", () => {
      throw new Error("A last admin must not be changed");
    });
    t.mock.method(RoleChangeAudit, "create", async () => {
      throw new Error("No audit should be written");
    });

    await updateUserRole(
      {
        params: { userId: targetId },
        body: { role: "user" },
        user: { _id: actorId },
      },
      response(),
      (error) => {
        responseError = error;
      }
    );

    assert.equal(responseError.statusCode, 409);
    assert.match(responseError.message, /last administrator/i);
  });
});
