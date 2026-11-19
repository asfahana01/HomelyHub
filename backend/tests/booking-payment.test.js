import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { Booking } from "../src/models/bookingModel.js";
import { Property } from "../src/models/propertyModel.js";
import { WebhookEvent } from "../src/models/webhookEventModel.js";
import { RefundTask } from "../src/models/refundTaskModel.js";
import {
  confirmBookingPayment,
  reserveCheckoutHold,
  validateCapturedPayment,
} from "../src/services/bookingConfirmationService.js";
import {
  claimRefundTask,
  processRefundTask,
  reconcileRefundTask,
} from "../src/services/refundService.js";
import {
  claimWebhookEvent,
  markWebhookEventFailed,
  markWebhookEventProcessed,
} from "../src/services/webhookEventService.js";
import { createRefundWorker } from "../src/services/refundWorker.js";
import { startBackend } from "../src/utils/startup.js";
import {
  razorpayWebhook,
  verifyPayment,
} from "../src/controllers/bookingController.js";

const webhookSecret = "unit_test_webhook_secret";
const orderId = "order_test_123";
const paymentId = "pay_test_123";
const bookingId = "64b7f123456789abcdef0123";
const propertyId = "64b7f123456789abcdef0456";
const fromDate = new Date("2027-01-10T00:00:00.000Z");
const toDate = new Date("2027-01-12T00:00:00.000Z");

const makeBooking = (overrides = {}) => ({
  _id: bookingId,
  property: propertyId,
  user: "64b7f123456789abcdef0789",
  price: 500,
  fromDate,
  toDate,
  razorpayOrderId: orderId,
  paid: false,
  paymentStatus: "pending",
  ...overrides,
});

const makePayment = (overrides = {}) => ({
  id: paymentId,
  order_id: orderId,
  amount: 50000,
  currency: "INR",
  status: "captured",
  ...overrides,
});

const makeResponse = () => ({
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

const signedWebhookRequest = (event, eventId = "evt_test_1") => {
  const rawBody = Buffer.from(JSON.stringify(event));
  const signature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");
  return {
    headers: {
      "x-razorpay-signature": signature,
      "x-razorpay-event-id": eventId,
    },
    rawBody,
  };
};

const capturedEvent = (payment = makePayment()) => ({
  event: "payment.captured",
  payload: { payment: { entity: payment } },
});

const setWebhookSecret = (t) => {
  const previous = process.env.RAZORPAY_WEBHOOK_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;
  t.after(() => {
    if (previous === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = previous;
  });
};

const withFakeTransactions = (t) => {
  const previousReadyState = mongoose.connection.readyState;
  mongoose.connection.readyState = 1;
  t.after(() => {
    mongoose.connection.readyState = previousReadyState;
  });

  t.mock.method(mongoose, "startSession", async () => ({
    async withTransaction(callback) {
      await callback();
    },
    async endSession() {},
  }));
};

describe("Razorpay booking confirmation", () => {
  test("accepts a correctly signed captured-payment webhook and confirms both records", async (t) => {
    setWebhookSecret(t);
    withFakeTransactions(t);
    const booking = makeBooking();
    let updatedProperty;
    let updatedBooking;
    t.mock.method(WebhookEvent, "findOne", async () => null);
    t.mock.method(WebhookEvent, "findOneAndUpdate", async () => ({
      eventId: "evt_test_1",
      status: "processing",
    }));
    t.mock.method(Booking, "findOne", () => ({
      session: async () => booking,
    }));
    t.mock.method(Property.collection, "updateOne", async (_filter, update) => {
      updatedProperty = update;
      return { matchedCount: 1 };
    });
    t.mock.method(Booking, "findOneAndUpdate", async (_filter, update) => {
      updatedBooking = update.$set;
      return {
        ...booking,
        ...update.$set,
        paymentStatus: update.$set.paymentStatus === "confirming"
          ? "confirming"
          : "paid",
      };
    });

    const response = makeResponse();
    await razorpayWebhook(signedWebhookRequest(capturedEvent()), response);

    assert.equal(response.statusCode, 200);
    assert.equal(updatedProperty.$addToSet.currentBookings.bookingId, bookingId);
    assert.equal(updatedProperty.$pull.bookingHolds.bookingId, bookingId);
    assert.equal(updatedBooking.paid, true);
    assert.equal(updatedBooking.paymentStatus, "paid");
    assert.equal(updatedBooking.razorpayPaymentId, paymentId);
  });

  test("rejects invalid and missing webhook signatures before touching persistence", async (t) => {
    setWebhookSecret(t);
    let persistenceCalls = 0;
    t.mock.method(WebhookEvent, "findOne", async () => {
      persistenceCalls += 1;
      return null;
    });
    t.mock.method(WebhookEvent, "updateOne", async () => {
      persistenceCalls += 1;
    });

    const invalidRequest = signedWebhookRequest(capturedEvent());
    invalidRequest.headers["x-razorpay-signature"] = "0".repeat(64);
    const invalidResponse = makeResponse();
    await razorpayWebhook(invalidRequest, invalidResponse);
    assert.equal(invalidResponse.statusCode, 400);

    const missingResponse = makeResponse();
    await razorpayWebhook(
      { headers: {}, rawBody: Buffer.from(JSON.stringify(capturedEvent())) },
      missingResponse
    );
    assert.equal(missingResponse.statusCode, 400);
    assert.equal(persistenceCalls, 0);
  });

  test("rejects captured payments with wrong amount, currency, or status", async (t) => {
    withFakeTransactions(t);
    const booking = makeBooking();
    const cases = [
      [makePayment({ amount: 49999 }), /amount or currency mismatch/],
      [makePayment({ currency: "USD" }), /amount or currency mismatch/],
      [makePayment({ status: "authorized" }), /not been captured/],
    ];

    for (const [payment, error] of cases) {
      assert.throws(
        () => validateCapturedPayment(payment, booking, orderId),
        error
      );
    }

    let propertyWrites = 0;
    t.mock.method(Booking, "findOne", () => ({
      session: async () => booking,
    }));
    t.mock.method(Property.collection, "updateOne", async () => {
      propertyWrites += 1;
      return { matchedCount: 1 };
    });
    for (const [payment] of cases) {
      await assert.rejects(
        confirmBookingPayment({ orderId, payment }),
        /amount or currency mismatch|not been captured/
      );
    }
    assert.equal(propertyWrites, 0);
  });

  test("does not mutate booking state for an invalid frontend signature", async (t) => {
    const previous = process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_KEY_SECRET;
    t.after(() => {
      if (previous !== undefined) process.env.RAZORPAY_KEY_SECRET = previous;
    });
    let databaseCalls = 0;
    t.mock.method(Booking, "findOne", async () => {
      databaseCalls += 1;
      return makeBooking();
    });
    t.mock.method(Booking, "updateOne", async () => {
      databaseCalls += 1;
    });

    const response = makeResponse();
    await verifyPayment(
      {
        body: {
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: "invalid",
        },
        user: { _id: "64b7f123456789abcdef0789" },
      },
      response
    );

    assert.equal(response.statusCode, 400);
    assert.equal(databaseCalls, 0);
  });

  test("deduplicates repeated webhook event IDs", async (t) => {
    setWebhookSecret(t);
    withFakeTransactions(t);
    const booking = makeBooking();
    let eventRow;
    let propertyWrites = 0;
    t.mock.method(WebhookEvent, "findOne", async () =>
      eventRow ? { ...eventRow } : null
    );
    t.mock.method(WebhookEvent, "findOneAndUpdate", async (filter, update, options) => {
      if (options?.upsert) {
        eventRow ||= {
          ...update.$setOnInsert,
          status: "pending",
        };
        return { ...eventRow };
      }

      if (filter.status === "processing") {
        if (
          eventRow?.status !== "processing" ||
          eventRow.claimToken !== filter.claimToken
        ) {
          return null;
        }
        eventRow = { ...eventRow, ...update.$set };
        return { ...eventRow };
      }

      if (
        eventRow?.status !== "pending" &&
        !(eventRow?.status === "processing" &&
          eventRow.leaseExpiresAt <= filter.$or[1].leaseExpiresAt.$lte)
      ) {
        return null;
      }
      eventRow = { ...eventRow, ...update.$set };
      return { ...eventRow };
    });
    t.mock.method(Booking, "findOne", () => ({
      session: async () => booking,
    }));
    t.mock.method(Property.collection, "updateOne", async () => {
      propertyWrites += 1;
      return { matchedCount: 1 };
    });
    t.mock.method(Booking, "findOneAndUpdate", async (_filter, update) => ({
      ...booking,
      ...update.$set,
    }));

    const request = signedWebhookRequest(capturedEvent(), "evt_duplicate");
    const firstResponse = makeResponse();
    const duplicateResponse = makeResponse();
    await razorpayWebhook(request, firstResponse);
    await razorpayWebhook(request, duplicateResponse);

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(duplicateResponse.statusCode, 200);
    assert.equal(propertyWrites, 1);
  });

  test("prevents two users from holding overlapping dates but permits an expired hold", async (t) => {
    const holds = [
      {
        fromDate,
        toDate,
        expiresAt: new Date(Date.now() - 1000),
      },
    ];
    t.mock.method(Property.collection, "updateOne", async (filter, update) => {
      const requested = update[0].$set.bookingHolds.$concatArrays[1][0];
      const now = filter.bookingHolds.$not.$elemMatch.expiresAt.$gt;
      const hasActiveOverlap = holds.some(
        (hold) =>
          hold.fromDate < requested.toDate &&
          hold.toDate > requested.fromDate &&
          hold.expiresAt > now
      );
      if (hasActiveOverlap) return null;

      for (let index = holds.length - 1; index >= 0; index -= 1) {
        if (holds[index].expiresAt <= now) {
          holds.splice(index, 1);
        }
      }
      holds.push(requested);
      return { matchedCount: 1 };
    });

    const first = makeBooking({ _id: "first", user: "user_1" });
    const second = makeBooking({ _id: "second", user: "user_2" });
    const [firstResult, secondResult] = await Promise.all([
      reserveCheckoutHold(first, new Date(Date.now() + 60_000)),
      reserveCheckoutHold(second, new Date(Date.now() + 60_000)),
    ]);

    assert.ok(firstResult);
    assert.equal(secondResult, null);
    assert.equal(holds.length, 1);
    assert.equal(holds[0].bookingId, "first");
  });

  test("confirms a booking idempotently and rejects a different payment ID", async (t) => {
    withFakeTransactions(t);
    const booking = makeBooking({
      paid: true,
      paymentStatus: "paid",
      razorpayPaymentId: paymentId,
    });
    let propertyWrites = 0;
    t.mock.method(Booking, "findOne", () => ({
      session: async () => booking,
    }));
    t.mock.method(Property.collection, "updateOne", async () => {
      propertyWrites += 1;
      return { matchedCount: 1 };
    });

    const result = await confirmBookingPayment({ orderId, payment: makePayment() });
    assert.equal(result.status, "confirmed");
    assert.equal(result.alreadyConfirmed, true);
    assert.equal(propertyWrites, 0);

    await assert.rejects(
      confirmBookingPayment({
        orderId,
        payment: makePayment({ id: "pay_different" }),
      }),
      /different payment/
    );
  });

  test("records a captured payment for refund recovery when dates are no longer available", async (t) => {
    withFakeTransactions(t);
    const booking = makeBooking();
    t.mock.method(Booking, "findOne", () => ({
      session: async () => booking,
    }));
    t.mock.method(Property.collection, "updateOne", async () => ({ matchedCount: 0 }));
    let statusUpdate;
    t.mock.method(Booking, "findOneAndUpdate", async (_filter, update) => {
      statusUpdate = update.$set;
      return { ...booking, ...update.$set };
    });
    t.mock.method(Property, "updateOne", async () => ({}));
    t.mock.method(Booking, "findById", () => ({
      session: async () => ({
        ...booking,
        paymentStatus: "refund_pending",
        razorpayPaymentId: paymentId,
      }),
    }));
    t.mock.method(RefundTask, "updateOne", async () => ({}));

    const result = await confirmBookingPayment({ orderId, payment: makePayment() });
    assert.equal(result.status, "refund_pending");
    assert.equal(statusUpdate.paymentStatus, "refund_pending");
    assert.equal(statusUpdate.razorpayPaymentId, paymentId);
    assert.equal(statusUpdate.paid, false);
  });

  test("rejects incorrect payment ID and incorrect Razorpay order ID", () => {
    const booking = makeBooking();
    assert.throws(
      () =>
        validateCapturedPayment(
          makePayment({ id: "pay_wrong" }),
          booking,
          orderId,
          paymentId
        ),
      /Payment ID does not match/
    );
    assert.throws(
      () =>
        validateCapturedPayment(
          makePayment({ order_id: "order_wrong" }),
          booking,
          orderId
        ),
      /does not belong/
    );
  });

  test("fails closed when MongoDB transactions are unavailable", async (t) => {
    const previousReadyState = mongoose.connection.readyState;
    mongoose.connection.readyState = 1;
    t.after(() => {
      mongoose.connection.readyState = previousReadyState;
    });
    t.mock.method(mongoose, "startSession", async () => ({
      async withTransaction() {
        const error = new Error(
          "Transaction numbers are only allowed on a replica set member"
        );
        error.code = 20;
        throw error;
      },
      async endSession() {},
    }));

    await assert.rejects(
      confirmBookingPayment({
        orderId,
        payment: makePayment(),
      }),
      /MongoDB transactions are not supported/
    );
  });

  test("refund task schema stores the captured payment safely", async () => {
    const task = new RefundTask({
      booking: bookingId,
      orderId,
      paymentId,
      amount: 50000,
      currency: "INR",
    });
    assert.equal(task.status, "pending");
    assert.equal(task.currency, "INR");
    assert.equal(task.amount, 50000);
    assert.equal(task.attempts, 0);
    await assert.doesNotReject(task.validate());
  });

  test("two simultaneous webhook claims permit only one owner", async (t) => {
    let event;
    t.mock.method(WebhookEvent, "findOneAndUpdate", async (filter, update, options) => {
      if (options?.upsert) {
        event ||= {
          ...update.$setOnInsert,
          leaseExpiresAt: null,
        };
        return { ...event };
      }

      const now = new Date();
      const status = event?.status;
      const claimable =
        event &&
        (["pending", "failed"].includes(status) ||
          !status ||
          (status === "processing" && event.leaseExpiresAt <= now));
      if (!claimable) return null;

      event = {
        ...event,
        ...update.$set,
      };
      return { ...event };
    });
    t.mock.method(WebhookEvent, "findOne", async () => event && { ...event });

    const [first, second] = await Promise.all([
      claimWebhookEvent({ eventId: "evt_concurrent", eventType: "payment.captured" }),
      claimWebhookEvent({ eventId: "evt_concurrent", eventType: "payment.captured" }),
    ]);

    assert.equal([first, second].filter((claim) => claim.claimed).length, 1);
    assert.notEqual(first.claimToken, second.claimToken);
    assert.equal(event.status, "processing");
  });

  test("an expired webhook lease can be reclaimed with a new token", async (t) => {
    let event = {
      eventId: "evt_expired",
      eventType: "payment.captured",
      status: "processing",
      claimToken: "expired-token",
      leaseExpiresAt: new Date(Date.now() - 1000),
    };
    t.mock.method(WebhookEvent, "findOneAndUpdate", async (filter, update, options) => {
      if (options?.upsert) return { ...event };
      if (
        filter.eventId === event.eventId &&
        filter.$or.some((clause) =>
          clause.status === "processing" &&
          event.status === "processing" &&
            event.leaseExpiresAt <= clause.leaseExpiresAt.$not.$gt
        )
      ) {
        event = { ...event, ...update.$set };
        return { ...event };
      }
      return null;
    });
    t.mock.method(WebhookEvent, "findOne", async () => ({ ...event }));

    const claim = await claimWebhookEvent({
      eventId: event.eventId,
      eventType: event.eventType,
    });
    assert.equal(claim.claimed, true);
    assert.notEqual(claim.claimToken, "expired-token");
  });

  test("stale webhook workers cannot mark a reclaimed event processed or failed", async (t) => {
    const event = {
      eventId: "evt_reclaimed",
      status: "processing",
      claimToken: "new-token",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    };
    const writes = [];
    t.mock.method(WebhookEvent, "findOneAndUpdate", async (filter) => {
      writes.push(filter);
      if (
        filter.eventId !== event.eventId ||
        filter.claimToken !== event.claimToken ||
        filter.status !== event.status
      ) {
        return null;
      }
      return event;
    });

    const processed = await markWebhookEventProcessed(event.eventId, "old-token");
    const failed = await markWebhookEventFailed(
      event.eventId,
      "old-token",
      new Error("stale worker")
    );
    assert.equal(processed, null);
    assert.equal(failed, null);
    assert.equal(event.status, "processing");
    assert.equal(writes.length, 2);
    assert.equal(writes[0].claimToken, "old-token");
    assert.equal(writes[1].claimToken, "old-token");
  });

  test("two simultaneous refund claims permit only one owner", async (t) => {
    let task = {
      _id: "refund_concurrent",
      status: "pending",
      attempts: 0,
      nextRetryAt: new Date(Date.now() - 1000),
      leaseExpiresAt: null,
    };
    t.mock.method(RefundTask, "findOneAndUpdate", async (filter, update) => {
      const now = new Date();
      const canClaim =
        task.attempts < filter.attempts.$lt &&
        task.nextRetryAt <= filter.nextRetryAt.$lte &&
        (task.status !== "processing" ||
          task.leaseExpiresAt <= now);
      if (!canClaim) return null;

      task = {
        ...task,
        ...update[0].$set,
        attempts: task.attempts + 1,
      };
      return { ...task };
    });

    const [first, second] = await Promise.all([
      claimRefundTask(),
      claimRefundTask(),
    ]);

    assert.equal([first, second].filter(Boolean).length, 1);
    assert.ok(first?.claimToken || second?.claimToken);
    assert.equal(task.status, "processing");
  });

  test("expired refund leases can be reclaimed with a new token", async (t) => {
    let task = {
      _id: "refund_expired",
      status: "processing",
      attempts: 1,
      nextRetryAt: new Date(Date.now() - 60_000),
      leaseExpiresAt: new Date(Date.now() - 1000),
      claimToken: "expired-token",
    };
    t.mock.method(RefundTask, "findOneAndUpdate", async (_filter, update) => {
      task = {
        ...task,
        ...update[0].$set,
        attempts: task.attempts + 1,
      };
      return { ...task };
    });

    const claim = await claimRefundTask();
    assert.equal(claim.status, "processing");
    assert.notEqual(claim.claimToken, "expired-token");
    assert.equal(claim.attempts, 2);
  });

  test("stale refund workers cannot overwrite a newer claim", async (t) => {
    let currentTask = {
      _id: "refund_reclaimed",
      status: "processing",
      claimToken: "new-token",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    };
    let updateFilter;
    t.mock.method(RefundTask, "exists", async () => null);
    t.mock.method(RefundTask, "updateOne", async (filter) => {
      updateFilter = filter;
      if (filter.claimToken !== currentTask.claimToken) {
        return { matchedCount: 0 };
      }
      currentTask = { ...currentTask, status: "failed" };
      return { matchedCount: 1 };
    });

    const result = await processRefundTask(
      {
        _id: currentTask._id,
        paymentId,
        attempts: 1,
        claimToken: "old-token",
      },
      async () => {
        throw new Error("A stale worker must not reach Razorpay.");
      }
    );

    assert.equal(result.status, "stale");
    assert.equal(updateFilter.claimToken, "old-token");
    assert.equal(currentTask.status, "processing");
  });

  test("failed refund attempts remain retryable after backoff", async (t) => {
    let task = {
      _id: "refund_retry",
      status: "processing",
      attempts: 1,
      paymentId,
      claimToken: "first-token",
      leaseExpiresAt: new Date(Date.now() + 60_000),
      nextRetryAt: new Date(Date.now() - 1000),
    };
    t.mock.method(RefundTask, "updateOne", async (filter, update) => {
      if (filter.claimToken !== task.claimToken) return { matchedCount: 0 };
      task = { ...task, ...update.$set };
      return { matchedCount: 1 };
    });

    const failed = await processRefundTask(task, async () => {
      throw new Error("temporary Razorpay network failure");
    });
    assert.equal(failed.status, "failed");
    assert.equal(task.status, "failed");
    assert.match(task.lastError, /temporary Razorpay network failure/);

    t.mock.method(RefundTask, "findOneAndUpdate", async (_filter, update) => {
      task = {
        ...task,
        ...update[0].$set,
        attempts: task.attempts + 1,
      };
      return { ...task };
    });
    const retried = await claimRefundTask(new Date(Date.now() + 60_000));
    assert.equal(retried.status, "processing");
    assert.equal(retried.attempts, 2);
    assert.notEqual(retried.claimToken, "first-token");
  });

  test("refund worker prevents overlapping cycles and resumes after errors", async () => {
    let releaseCycle;
    let calls = 0;
    const worker = createRefundWorker({
      runOnce: async () => {
        calls += 1;
        if (calls === 1) {
          await new Promise((resolve) => {
            releaseCycle = resolve;
          });
        } else if (calls === 2) {
          throw new Error("transient cycle error");
        }
      },
    });

    const firstCycle = worker.runCycle();
    const overlappingCycle = await worker.runCycle();
    assert.equal(overlappingCycle, false);
    releaseCycle();
    assert.equal(await firstCycle, true);

    assert.equal(await worker.runCycle(), true);
    assert.equal(await worker.runCycle(), true);
    assert.equal(calls, 3);
  });

  test("startup waits for MongoDB before starting the worker and listening", async () => {
    const events = [];
    let finishConnect;
    let rejectConnect = true;
    const connect = () => {
      events.push("connect");
      if (rejectConnect) {
        rejectConnect = false;
        return Promise.reject(new Error("database unavailable"));
      }
      return new Promise((resolve) => {
        finishConnect = resolve;
      });
    };
    const startWorker = async () => {
      events.push("worker");
    };
    const listen = () => {
      events.push("listen");
      return "server";
    };

    await assert.rejects(
      startBackend({ connect, startWorker, listen }),
      /database unavailable/
    );
    assert.deepEqual(events, ["connect"]);

    const startup = startBackend({ connect, startWorker, listen });
    assert.deepEqual(events, ["connect", "connect"]);
    finishConnect();
    const concurrentStartup = startBackend({ connect, startWorker, listen });
    assert.equal(await startup, "server");
    assert.equal(await concurrentStartup, "server");
    assert.deepEqual(events, ["connect", "connect", "worker", "listen"]);
  });

  test("refund reconciliation does not create another refund when Razorpay already has it", async (t) => {
    const task = {
      _id: "refund_task_1",
      paymentId,
      refundId: "rfnd_existing",
      amount: 50000,
      booking: bookingId,
      attempts: 1,
      claimToken: "refund-token",
    };
    let refundCalls = 0;
    const razorpay = {
      payments: {
        fetch: async () => ({ id: paymentId, status: "captured" }),
        fetchRefund: async () => ({ id: "rfnd_existing", status: "processed" }),
        refund: async () => {
          refundCalls += 1;
        },
      },
    };

    t.mock.method(RefundTask, "exists", async () => ({ _id: task._id }));
    const refund = await reconcileRefundTask(task, razorpay);
    assert.equal(refund.id, "rfnd_existing");
    assert.equal(refund.status, "processed");
    assert.equal(refundCalls, 0);
  });

  test("refund task uses pending, processed, and failed state transitions", async (t) => {
    const task = {
      _id: "refund_task_1",
      booking: bookingId,
      paymentId,
      amount: 50000,
      attempts: 1,
      claimToken: "refund-token",
    };
    const updates = [];
    t.mock.method(RefundTask, "updateOne", async (_filter, update) => {
      updates.push(update.$set);
      return {};
    });
    t.mock.method(Booking, "updateOne", async () => ({}));

    t.mock.method(RefundTask, "exists", async () => ({ _id: task._id }));
    const pendingTask = { ...task };
    const pendingReconciler = await reconcileRefundTask(
      pendingTask,
      {
        payments: {
          fetch: async () => ({ id: paymentId, status: "captured" }),
          fetchMultipleRefund: async () => ({
            items: [
              {
                id: "rfnd_pending",
                payment_id: paymentId,
                amount: 50000,
                currency: "INR",
                status: "pending",
              },
            ],
          }),
        },
      }
    );
    assert.equal(pendingReconciler.status, "pending");

    const processed = await reconcileRefundTask(
      task,
      {
        payments: {
          fetch: async () => ({ id: paymentId, status: "captured" }),
          fetchMultipleRefund: async () => ({
            items: [
              {
                id: "rfnd_processed",
                payment_id: paymentId,
                amount: 50000,
                currency: "INR",
                status: "processed",
              },
            ],
          }),
        },
      }
    );
    assert.equal(processed.status, "processed");
    assert.equal(updates.length, 0);
  });

});
