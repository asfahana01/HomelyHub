import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { Booking } from "../src/models/bookingModel.js";
import { Property } from "../src/models/propertyModel.js";
import { RefundTask } from "../src/models/refundTaskModel.js";
import { bookingRouter } from "../src/routes/bookingRouter.js";
import {
  assertBookingCancellationEligible,
  processRefundWebhook,
  processRefundTask,
  reconcileRefundTask,
  requestBookingCancellation,
  RefundManagementError,
} from "../src/services/refundService.js";
import { createRazorpayRefund } from "../src/utils/razorpay.js";
import { parseRazorpayWebhookEvent } from "../src/utils/validation.js";

const bookingId = "64b7f123456789abcdef0123";
const propertyId = "64b7f123456789abcdef0456";
const userId = "64b7f123456789abcdef0789";
const orderId = "order_test_123";
const paymentId = "pay_test_123";
const refundId = "rfnd_test_123";
const bookingPrice = 500;
const fromDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
const toDate = new Date(fromDate.getTime() + 2 * 24 * 60 * 60 * 1000);

const makeBooking = (overrides = {}) => ({
  _id: bookingId,
  property: propertyId,
  user: userId,
  price: bookingPrice,
  fromDate,
  toDate,
  paid: true,
  paymentStatus: "paid",
  cancellationStatus: "none",
  razorpayOrderId: orderId,
  razorpayPaymentId: paymentId,
  ...overrides,
});

const makePayment = (overrides = {}) => ({
  id: paymentId,
  order_id: orderId,
  amount: bookingPrice * 100,
  currency: "INR",
  status: "captured",
  ...overrides,
});

const queryFor = (value) => ({
  session: async () => value,
  then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
});

const setReadyDatabase = (t) => {
  const previousReadyState = mongoose.connection.readyState;
  mongoose.connection.readyState = 1;
  t.after(() => {
    mongoose.connection.readyState = previousReadyState;
  });
  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  }));
};

const taskFor = (overrides = {}) => ({
  _id: "refund_task_123",
  booking: bookingId,
  orderId,
  paymentId,
  amount: bookingPrice * 100,
  currency: "INR",
  reason: "customer_cancellation",
  status: "processing",
  attempts: 1,
  claimToken: "claim-token",
  leaseExpiresAt: new Date(Date.now() + 60_000),
  ...overrides,
});

const refundEvent = (event, status, overrides = {}) => ({
  event,
  payload: {
    refund: {
      entity: {
        id: refundId,
        payment_id: paymentId,
        amount: bookingPrice * 100,
        currency: "INR",
        status,
        notes: { homelyhub_refund_task: "refund_task_123" },
        ...overrides,
      },
    },
    payment: {
      entity: {
        id: paymentId,
        order_id: orderId,
        amount: bookingPrice * 100,
        currency: "INR",
      },
    },
  },
});

describe("booking cancellation and refunds", () => {
  test("cancellation route is protected and validates booking IDs", () => {
    const route = bookingRouter.stack.find(
      (layer) => layer.route?.path === "/:bookingId/cancel"
    );
    assert.ok(route);
    assert.equal(route.route.methods.post, true);
    assert.equal(route.route.stack[0].name, "protect");
    assert.ok(route.route.stack.length >= 5);
  });

  test("cancellation policy rejects started and inside-cutoff bookings", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    assert.throws(
      () =>
        assertBookingCancellationEligible(
          makeBooking({ fromDate: new Date(now.getTime() + 23 * 60 * 60 * 1000) }),
          now,
          24
        ),
      /at least 24 hours/
    );
    assert.throws(
      () =>
        assertBookingCancellationEligible(
          makeBooking({ fromDate: new Date(now.getTime() - 1) }),
          now,
          0
        ),
      /at least 0 hours/
    );
  });

  test("successful cancellation atomically creates a full-refund task and releases dates", async (t) => {
    setReadyDatabase(t);
    let currentBooking = makeBooking();
    const storedTasks = [];
    let bookingUpdate;
    let bookingUpdateOptions;
    let refundCreateOptions;
    let propertyUpdate;
    t.mock.method(Booking, "findOne", () => queryFor(currentBooking));
    t.mock.method(Booking, "findOneAndUpdate", async (_filter, update, options) => {
      bookingUpdate = update.$set;
      bookingUpdateOptions = options;
      currentBooking = { ...currentBooking, ...update.$set };
      return currentBooking;
    });
    t.mock.method(RefundTask, "findOne", () => queryFor(null));
    t.mock.method(RefundTask, "create", async ([task], options) => {
      storedTasks.push(task);
      refundCreateOptions = options;
      return [task];
    });
    t.mock.method(Property, "updateOne", async (_filter, update, options) => {
      propertyUpdate = { update, options };
      return { matchedCount: 1 };
    });

    const result = await requestBookingCancellation({
      bookingId,
      userId,
      razorpay: { payments: { fetch: async () => makePayment() } },
    });

    assert.equal(result.booking.paymentStatus, "refund_pending");
    assert.equal(result.booking.cancellationStatus, "refund_pending");
    assert.equal(result.refundTask.amount, 50000);
    assert.equal(result.refundTask.reason, "customer_cancellation");
    assert.equal(storedTasks.length, 1);
    assert.equal(bookingUpdate.paymentStatus, "refund_pending");
    assert.equal(propertyUpdate.update.$pull.currentBookings.bookingId, bookingId);
    assert.ok(propertyUpdate.options.session);
    assert.equal(bookingUpdateOptions.session, refundCreateOptions.session);
    assert.equal(refundCreateOptions.session, propertyUpdate.options.session);
  });

  test("another user and unpaid bookings cannot initiate gateway refunds", async (t) => {
    setReadyDatabase(t);
    let paymentFetches = 0;
    let currentBooking = null;
    let bookingFilter;
    const razorpay = {
      payments: {
        fetch: async () => {
          paymentFetches += 1;
          return makePayment();
        },
      },
    };
    t.mock.method(Booking, "findOne", (filter) => {
      bookingFilter = filter;
      return queryFor(currentBooking);
    });

    await assert.rejects(
      requestBookingCancellation({ bookingId, userId, razorpay }),
      (error) => error.statusCode === 404
    );
    assert.equal(paymentFetches, 0);
    assert.equal(bookingFilter.user, userId);

    currentBooking = makeBooking({ paid: false, paymentStatus: "pending" });
    await assert.rejects(
      requestBookingCancellation({ bookingId, userId, razorpay }),
      (error) => error.statusCode === 409
    );
    assert.equal(paymentFetches, 0);
  });

  test("simultaneous cancellation requests create only one refund task", async (t) => {
    setReadyDatabase(t);
    let currentBooking = makeBooking();
    let taskCreations = 0;
    let bookingUpdates = 0;
    t.mock.method(Booking, "findOne", () => queryFor(currentBooking));
    t.mock.method(Booking, "findOneAndUpdate", async (_filter, update) => {
      if (currentBooking.paymentStatus !== "paid") return null;
      bookingUpdates += 1;
      currentBooking = { ...currentBooking, ...update.$set };
      return currentBooking;
    });
    t.mock.method(RefundTask, "findOne", () => queryFor(null));
    t.mock.method(RefundTask, "create", async () => {
      taskCreations += 1;
      return [taskFor()];
    });
    t.mock.method(Property, "updateOne", async () => ({ matchedCount: 1 }));

    const results = await Promise.allSettled([
      requestBookingCancellation({
        bookingId,
        userId,
        razorpay: { payments: { fetch: async () => makePayment() } },
      }),
      requestBookingCancellation({
        bookingId,
        userId,
        razorpay: { payments: { fetch: async () => makePayment() } },
      }),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(taskCreations, 1);
    assert.equal(bookingUpdates, 1);
  });

  test("a refund task already associated with the payment blocks cancellation", async (t) => {
    setReadyDatabase(t);
    let bookingUpdates = 0;
    t.mock.method(Booking, "findOne", () => queryFor(makeBooking()));
    t.mock.method(RefundTask, "findOne", () => queryFor(taskFor()));
    t.mock.method(Booking, "findOneAndUpdate", async () => {
      bookingUpdates += 1;
    });

    await assert.rejects(
      requestBookingCancellation({
        bookingId,
        userId,
        razorpay: { payments: { fetch: async () => makePayment() } },
      }),
      /refund has already been requested/
    );
    assert.equal(bookingUpdates, 0);
  });

  test("Razorpay API failure prevents cancellation state changes", async (t) => {
    setReadyDatabase(t);
    let bookingUpdates = 0;
    t.mock.method(Booking, "findOne", () => queryFor(makeBooking()));
    t.mock.method(Booking, "findOneAndUpdate", async () => {
      bookingUpdates += 1;
    });

    await assert.rejects(
      requestBookingCancellation({
        bookingId,
        userId,
        razorpay: {
          payments: {
            fetch: async () => {
              throw new Error("Gateway unavailable");
            },
          },
        },
      }),
      (error) => error.statusCode === 502
    );
    assert.equal(bookingUpdates, 0);
  });

  test("payment verification failure prevents cancellation state changes", async (t) => {
    setReadyDatabase(t);
    let writes = 0;
    t.mock.method(Booking, "findOne", () => queryFor(makeBooking()));
    t.mock.method(Booking, "findOneAndUpdate", async () => {
      writes += 1;
    });

    await assert.rejects(
      requestBookingCancellation({
        bookingId,
        userId,
        razorpay: {
          payments: { fetch: async () => makePayment({ amount: 1 }) },
        },
      }),
      (error) => error.statusCode === 409
    );
    assert.equal(writes, 0);
  });

  test("refund worker updates booking only after a confirmed processed refund", async (t) => {
    setReadyDatabase(t);
    const task = taskFor({ refundId });
    let taskUpdate;
    let bookingUpdate;
    t.mock.method(RefundTask, "updateOne", async (_filter, update, options) => {
      taskUpdate = { update, options };
      return { matchedCount: 1 };
    });
    t.mock.method(Booking, "updateOne", async (_filter, update, options) => {
      bookingUpdate = { update, options };
      return { matchedCount: 1 };
    });

    t.mock.method(RefundTask, "exists", async () => ({ _id: task._id }));
    const razorpay = {
      payments: {
        fetch: async () => makePayment(),
        fetchRefund: async () => ({
          id: refundId,
          payment_id: paymentId,
          amount: 50000,
          currency: "INR",
          status: "processed",
        }),
      },
    };
    const result = await processRefundTask(task, (claimedTask, _, token) =>
      reconcileRefundTask(claimedTask, razorpay, token)
    );

    assert.equal(result.status, "processed");
    assert.equal(taskUpdate.update.$set.status, "processed");
    assert.equal(bookingUpdate.update.$set.paymentStatus, "refund_processed");
    assert.equal(bookingUpdate.update.$set.cancellationStatus, "cancelled");
    assert.equal(taskUpdate.options.session, bookingUpdate.options.session);
  });

  test("worker reconciliation reads refund state after the create API response", async (t) => {
    const task = taskFor({ refundId: null });
    let fetches = 0;
    let refundCreates = 0;
    t.mock.method(RefundTask, "exists", async () => ({ _id: task._id }));
    t.mock.method(RefundTask, "updateOne", async (_filter, update) => {
      Object.assign(task, update.$set);
      return { matchedCount: 1 };
    });
    const razorpay = {
      payments: {
        fetch: async () => makePayment(),
        fetchMultipleRefund: async () => ({ items: [] }),
        fetchRefund: async () => {
          fetches += 1;
          return {
            id: refundId,
            payment_id: paymentId,
            amount: 50000,
            currency: "INR",
            status: "pending",
          };
        },
      },
    };
    const refundRequest = async () => {
      refundCreates += 1;
      return { id: refundId, status: "processed" };
    };
    const refund = await reconcileRefundTask(
      task,
      razorpay,
      task.claimToken,
      refundRequest
    );
    assert.equal(refund.status, "pending");
    assert.equal(fetches, 1);
    assert.equal(refundCreates, 1);
  });

  test("refund API requests carry Razorpay's stable idempotency header", async (t) => {
    const previousKeyId = process.env.RAZORPAY_KEY_ID;
    const previousKeySecret = process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_ID = "rzp_test_id";
    process.env.RAZORPAY_KEY_SECRET = "test_secret";
    t.after(() => {
      if (previousKeyId === undefined) delete process.env.RAZORPAY_KEY_ID;
      else process.env.RAZORPAY_KEY_ID = previousKeyId;
      if (previousKeySecret === undefined) {
        delete process.env.RAZORPAY_KEY_SECRET;
      } else {
        process.env.RAZORPAY_KEY_SECRET = previousKeySecret;
      }
    });

    let request;
    t.mock.method(globalThis, "fetch", async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ id: refundId, status: "pending" }),
      };
    });

    const result = await createRazorpayRefund({
      paymentId,
      amount: 50000,
      idempotencyKey: "stable-refund-key-123",
      notes: { homelyhub_refund_task: "refund_task_123" },
      receipt: `refund_${paymentId}`,
    });

    assert.equal(result.id, refundId);
    assert.equal(
      request.options.headers["X-Refund-Idempotency"],
      "stable-refund-key-123"
    );
    assert.equal(
      request.options.headers.Authorization,
      `Basic ${Buffer.from("rzp_test_id:test_secret").toString("base64")}`
    );
    assert.equal(new URL(request.url).pathname, `/v1/payments/${paymentId}/refund`);
    assert.equal(JSON.parse(request.options.body).amount, 50000);
  });

  test("refund retries reuse an idempotency key after an uncertain API failure", async (t) => {
    const task = taskFor({ refundId: null, refundIdempotencyKey: "retry-key-123" });
    const keys = [];
    t.mock.method(RefundTask, "exists", async () => ({ _id: task._id }));
    const razorpay = {
      payments: {
        fetch: async () => makePayment(),
        fetchMultipleRefund: async () => ({ items: [] }),
        fetchRefund: async () => ({
          id: refundId,
          payment_id: paymentId,
          amount: 50000,
          currency: "INR",
          status: "pending",
        }),
      },
    };
    const makeRequest = async ({ idempotencyKey }) => {
      keys.push(idempotencyKey);
      if (keys.length === 1) throw new Error("network timeout");
      return { id: refundId };
    };

    await assert.rejects(
      reconcileRefundTask(task, razorpay, task.claimToken, makeRequest),
      /network timeout/
    );
    const result = await reconcileRefundTask(
      task,
      razorpay,
      task.claimToken,
      makeRequest
    );

    assert.equal(result.status, "pending");
    assert.deepEqual(keys, ["retry-key-123", "retry-key-123"]);
  });

  test("confirmed failed refunds rotate the persisted idempotency key before retry", async (t) => {
    const task = taskFor({ refundId: "rfnd_previous" });
    const updates = [];
    let requestKey;
    t.mock.method(RefundTask, "exists", async () => ({ _id: task._id }));
    t.mock.method(RefundTask, "updateOne", async (_filter, update) => {
      updates.push(update.$set);
      Object.assign(task, update.$set);
      return { matchedCount: 1 };
    });
    const razorpay = {
      payments: {
        fetch: async () => makePayment(),
        fetchRefund: async (_paymentId, id) => ({
          id,
          payment_id: paymentId,
          amount: 50000,
          currency: "INR",
          status: id === "rfnd_previous" ? "failed" : "pending",
          notes: { homelyhub_refund_attempt: "old-attempt-key" },
        }),
        fetchMultipleRefund: async () => ({
          items: [
            {
              id: "rfnd_previous",
              payment_id: paymentId,
              amount: 50000,
              currency: "INR",
              status: "failed",
            },
          ],
        }),
      },
    };
    const refundRequest = async (request) => {
      requestKey = request.idempotencyKey;
      return { id: "rfnd_retry" };
    };

    const result = await reconcileRefundTask(
      task,
      razorpay,
      task.claimToken,
      refundRequest
    );

    assert.equal(result.status, "pending");
    assert.ok(requestKey);
    assert.notEqual(requestKey, "old-attempt-key");
    assert.equal(task.refundIdempotencyKey, requestKey);
    assert.ok(updates.length > 0);
  });

  test("processed refund webhook updates task and booking, and later failure cannot downgrade it", async (t) => {
    setReadyDatabase(t);
    const task = taskFor({ refundId: null });
    let taskStatus = "processing";
    let taskUpdates = 0;
    let bookingUpdates = 0;
    t.mock.method(RefundTask, "findOne", () => queryFor(task));
    t.mock.method(RefundTask, "updateOne", async (_filter, update) => {
      taskUpdates += 1;
      taskStatus = update.$set.status;
      task.refundId = update.$set.refundId;
      task.status = taskStatus;
      return { matchedCount: 1 };
    });
    t.mock.method(Booking, "updateOne", async (_filter, update) => {
      bookingUpdates += 1;
      assert.equal(update.$set.paymentStatus, "refund_processed");
      return { matchedCount: 1 };
    });

    const processed = await processRefundWebhook({
      eventType: "refund.processed",
      refund: refundEvent("refund.processed", "processed").payload.refund.entity,
      payment: makePayment(),
    });
    const lateFailure = await processRefundWebhook({
      eventType: "refund.failed",
      refund: refundEvent("refund.failed", "failed").payload.refund.entity,
      payment: makePayment(),
    });

    assert.equal(processed.status, "processed");
    assert.equal(lateFailure.status, "processed");
    assert.equal(lateFailure.duplicate, true);
    assert.equal(taskStatus, "processed");
    assert.equal(taskUpdates, 1);
    assert.equal(bookingUpdates, 1);
  });

  test("failed refund webhook schedules retry without marking the booking refunded", async (t) => {
    setReadyDatabase(t);
    const task = taskFor({ refundId: null });
    let taskUpdate;
    let bookingUpdates = 0;
    t.mock.method(RefundTask, "findOne", () => queryFor(task));
    t.mock.method(RefundTask, "updateOne", async (_filter, update) => {
      taskUpdate = update.$set;
      return { matchedCount: 1 };
    });
    t.mock.method(Booking, "updateOne", async () => {
      bookingUpdates += 1;
      return { matchedCount: 1 };
    });

    const result = await processRefundWebhook({
      eventType: "refund.failed",
      refund: refundEvent("refund.failed", "failed").payload.refund.entity,
      payment: makePayment(),
    });

    assert.equal(result.status, "failed");
    assert.equal(taskUpdate.status, "failed");
    assert.equal(taskUpdate.refundId, refundId);
    assert.ok(taskUpdate.nextRetryAt > new Date());
    assert.equal(bookingUpdates, 0);
  });

  test("refund webhook parser enforces matching event and gateway status", () => {
    const valid = refundEvent("refund.processed", "processed");
    assert.equal(parseRazorpayWebhookEvent(valid).event, "refund.processed");
    assert.throws(() =>
      parseRazorpayWebhookEvent(
        refundEvent("refund.processed", "failed")
      )
    );
    assert.throws(() =>
      parseRazorpayWebhookEvent(
        refundEvent("refund.failed", "failed", { amount: 0 })
      )
    );
  });

  test("cancellation transaction fails closed when MongoDB transactions are unavailable", async (t) => {
    const previousReadyState = mongoose.connection.readyState;
    mongoose.connection.readyState = 1;
    t.after(() => {
      mongoose.connection.readyState = previousReadyState;
    });
    t.mock.method(Booking, "findOne", () => queryFor(makeBooking()));
    t.mock.method(mongoose, "startSession", async () => ({
      withTransaction: async () => {
        const error = new Error(
          "Transaction numbers are only allowed on a replica set member"
        );
        error.code = 20;
        throw error;
      },
      endSession: async () => {},
    }));

    await assert.rejects(
      requestBookingCancellation({
        bookingId,
        userId,
        razorpay: { payments: { fetch: async () => makePayment() } },
      }),
      (error) => error instanceof RefundManagementError && error.statusCode === 503
    );
  });
});
