import { test, describe } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import {
  verifyRazorpaySignature,
  verifyWebhookSignature,
} from "../src/utils/razorpay.js";
import { sanitizeNoSql } from "../src/utils/security.js";
import { filterObj, signinToken } from "../src/utils/token.js";
import { restrictTo } from "../src/controllers/authController.js";
import { Booking } from "../src/models/bookingModel.js";
import { User } from "../src/models/userModel.js";

describe("Security Test Suite - HomelyHub", () => {
  // Test 1: Authentication & JWT Security
  describe("Phase 1: Authentication & Token Security", () => {
    test("Should sign and verify a valid JWT token", () => {
      process.env.JWT_SECRET = "test_super_secret_key_1234567890_min_32_chars";
      process.env.JWT_EXPIRES_IN = "1h";

      const fakeUserId = "64b7f123456789abcdef0123";
      const token = signinToken(fakeUserId);

      assert.ok(token, "Token should be generated");
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      assert.equal(decoded.id, fakeUserId, "Decoded user ID must match");
    });

    test("Should reject an invalid or tampered JWT token", () => {
      process.env.JWT_SECRET = "test_super_secret_key_1234567890_min_32_chars";
      // Token signed with a different secret
      const forgedToken = jwt.sign({ id: "123" }, "completely_wrong_secret");

      assert.throws(() => {
        jwt.verify(forgedToken, process.env.JWT_SECRET);
      }, /JsonWebTokenError|invalid signature/);
    });

    test("Should reject an expired JWT token", () => {
      process.env.JWT_SECRET = "test_super_secret_key_1234567890_min_32_chars";
      const expiredToken = jwt.sign(
        { id: "123", iat: Math.floor(Date.now() / 1000) - 3600 },
        process.env.JWT_SECRET,
        { expiresIn: "1ms" }
      );

      assert.throws(() => {
        jwt.verify(expiredToken, process.env.JWT_SECRET);
      }, /TokenExpiredError|jwt expired/);
    });

    test("filterObj must strip role and password from update payloads", () => {
      const maliciousBody = {
        name: "Legit Name",
        phoneNumber: "9876543210",
        role: "admin",
        password: "newPassword123",
        isAdmin: true,
      };

      const filtered = filterObj(maliciousBody, "name", "phoneNumber", "avatar");

      assert.equal(filtered.name, "Legit Name");
      assert.equal(filtered.phoneNumber, "9876543210");
      assert.equal(filtered.role, undefined, "Role field must be stripped");
      assert.equal(filtered.password, undefined, "Password field must be stripped");
      assert.equal(filtered.isAdmin, undefined, "Arbitrary fields must be stripped");
    });
  });

  // Test 2: IDOR and Authorization Prevention
  describe("Phase 2 & Phase 14: IDOR and RBAC Authorization", () => {
    test("restrictTo middleware should block users without permitted roles with 403", () => {
      const adminGuard = restrictTo("admin");

      const reqUser = { role: "user", _id: "user_123" };
      let statusCode = null;
      let responseBody = null;

      const mockRes = {
        status(code) {
          statusCode = code;
          return {
            json(body) {
              responseBody = body;
            },
          };
        },
      };

      let nextCalled = false;
      adminGuard({ user: reqUser }, mockRes, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false, "next() must not be called for normal user");
      assert.equal(statusCode, 403, "Status code must be 403 Forbidden");
      assert.equal(responseBody.status, "fail");
    });

    test("restrictTo middleware should permit admin role", () => {
      const adminGuard = restrictTo("admin");

      const reqAdmin = { role: "admin", _id: "admin_123" };
      let nextCalled = false;

      adminGuard({ user: reqAdmin }, {}, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true, "next() must be called for admin");
    });
  });

  // Test 3: Razorpay Payment Gateway & Cryptographic Verification
  describe("Phase 3: Razorpay Payment Signature Verification", () => {
    const testSecret = "secret_rzp_key_test_123456";
    const testOrderId = "order_O8xG1234567890";
    const testPaymentId = "pay_P8xG1234567890";

    test("Should successfully verify a valid HMAC SHA-256 Razorpay signature", () => {
      process.env.RAZORPAY_KEY_SECRET = testSecret;

      const validSignature = crypto
        .createHmac("sha256", testSecret)
        .update(`${testOrderId}|${testPaymentId}`)
        .digest("hex");

      const isValid = verifyRazorpaySignature({
        orderId: testOrderId,
        paymentId: testPaymentId,
        signature: validSignature,
      });

      assert.equal(isValid, true, "Valid cryptographic signature must verify successfully");
    });

    test("Should reject a forged or manipulated Razorpay signature", () => {
      process.env.RAZORPAY_KEY_SECRET = testSecret;

      const fakeSignature = crypto
        .createHmac("sha256", "wrong_secret")
        .update(`${testOrderId}|${testPaymentId}`)
        .digest("hex");

      const isValid = verifyRazorpaySignature({
        orderId: testOrderId,
        paymentId: testPaymentId,
        signature: fakeSignature,
      });

      assert.equal(isValid, false, "Forged signature must be rejected");
    });

    test("Should verify valid Razorpay webhook signature", () => {
      const webhookSecret = "webhook_secret_key_12345";
      process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

      const rawPayload = JSON.stringify({
        event: "order.paid",
        payload: { order: { entity: { id: testOrderId } } },
      });

      const validWebhookSig = crypto
        .createHmac("sha256", webhookSecret)
        .update(rawPayload)
        .digest("hex");

      const isValid = verifyWebhookSignature({
        rawBody: rawPayload,
        signature: validWebhookSig,
      });

      assert.equal(isValid, true, "Valid webhook signature must be accepted");
    });

    test("Should reject forged webhook signature", () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = "webhook_secret_key_12345";

      const rawPayload = JSON.stringify({ event: "order.paid" });
      const fakeSig = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

      const isValid = verifyWebhookSignature({
        rawBody: rawPayload,
        signature: fakeSig,
      });

      assert.equal(isValid, false, "Forged webhook signature must be rejected");
    });

    test("Booking model schema must have safe default paid: false and pending status", () => {
      const paths = Booking.schema.paths;

      assert.equal(
        paths.paid.defaultValue,
        false,
        "CRITICAL: Booking paid default must be false!"
      );
      assert.equal(
        paths.paymentStatus.defaultValue,
        "pending",
        "Booking paymentStatus default must be pending"
      );
    });
  });

  // Test 4: Business Logic & Date Overlap Prevention
  describe("Phase 4: Business Logic & Date Overlap Check", () => {
    test("Should correctly detect overlapping booking intervals", () => {
      const existingBookings = [
        {
          fromDate: new Date("2026-12-01T00:00:00.000Z"),
          toDate: new Date("2026-12-05T00:00:00.000Z"),
        },
      ];

      const checkOverlap = (requestedIn, requestedOut) => {
        const reqIn = new Date(requestedIn);
        const reqOut = new Date(requestedOut);
        return existingBookings.some((b) => b.fromDate < reqOut && b.toDate > reqIn);
      };

      // Completely overlapping inside
      assert.equal(checkOverlap("2026-12-02", "2026-12-04"), true, "Contained interval must overlap");
      // Overlapping check-in
      assert.equal(checkOverlap("2026-11-28", "2026-12-02"), true, "Overlapping check-in must overlap");
      // Overlapping check-out
      assert.equal(checkOverlap("2026-12-04", "2026-12-08"), true, "Overlapping check-out must overlap");
      // Non-overlapping: completely before
      assert.equal(checkOverlap("2026-11-20", "2026-11-30"), false, "Before interval must not overlap");
      // Non-overlapping: checkout on existing checkin day
      assert.equal(checkOverlap("2026-11-25", "2026-12-01"), false, "Consecutive booking must not overlap");
      // Non-overlapping: checkin on existing checkout day
      assert.equal(checkOverlap("2026-12-05", "2026-12-10"), false, "Consecutive booking must not overlap");
    });
  });

  // Test 5: NoSQL Injection Sanitization
  describe("Phase 5: API Security & NoSQL Injection Protection", () => {
    test("sanitizeNoSql should reject payloads containing MongoDB operator keys ($gt, $ne, etc.)", () => {
      const maliciousRequests = [
        { body: { email: { $gt: "" }, password: "test" }, query: {}, params: {} },
        { body: {}, query: { username: { $ne: null } }, params: {} },
        { body: { nested: { filter: { $where: "sleep(5000)" } } }, query: {}, params: {} },
      ];

      for (const req of maliciousRequests) {
        let statusCode = null;
        let body = null;
        const mockRes = {
          status(code) {
            statusCode = code;
            return {
              json(b) {
                body = b;
              },
            };
          },
        };

        let nextCalled = false;
        sanitizeNoSql(req, mockRes, () => {
          nextCalled = true;
        });

        assert.equal(nextCalled, false, "next() must not be called for injection attempt");
        assert.equal(statusCode, 400, "Must return HTTP 400 Bad Request");
        assert.equal(body.status, "fail");
      }
    });

    test("sanitizeNoSql should allow normal, clean requests", () => {
      const cleanReq = {
        body: {
          email: "user@example.com",
          password: "SecurePassword123!",
          guests: 2,
        },
        query: { city: "Goa", limit: 10 },
        params: { id: "64b7f123456789abcdef0123" },
      };

      let nextCalled = false;
      sanitizeNoSql(cleanReq, {}, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true, "Clean request must pass through");
    });
  });
});
