import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Booking } from "../src/models/bookingModel.js";
import { Property } from "../src/models/propertyModel.js";
import { WebhookEvent } from "../src/models/webhookEventModel.js";
import {
  confirmBookingPayment,
  reserveCheckoutHold,
  validateCapturedPayment,
} from "../src/services/bookingConfirmationService.js";
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

describe("Razorpay booking confirmation", () => {
  test("accepts a correctly signed captured-payment webhook and confirms both records", async (t) => {
    setWebhookSecret(t);
    const booking = makeBooking();
    let updatedProperty;
    let updatedBooking;
    t.mock.method(WebhookEvent, "findOne", async () => null);
    t.mock.method(WebhookEvent, "updateOne", async () => ({}));
    t.mock.method(Booking, "findOne", async () => booking);
    t.mock.method(Property.collection, "updateOne", async (_filter, update) => {
      updatedProperty = update;
      return { matchedCount: 1 };
    });
    t.mock.method(Booking, "findOneAndUpdate", async (_filter, update) => {
      updatedBooking = update.$set;
      return { ...booking, ...update.$set };
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
    t.mock.method(Booking, "findOne", async () => booking);
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
    const booking = makeBooking();
    let processed = false;
    let propertyWrites = 0;
    t.mock.method(WebhookEvent, "findOne", async () =>
      processed ? { processedAt: new Date() } : null
    );
    t.mock.method(WebhookEvent, "updateOne", async (_filter, update) => {
      if (update.$set?.processedAt) processed = true;
      return {};
    });
    t.mock.method(Booking, "findOne", async () => booking);
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
    const booking = makeBooking({
      paid: true,
      paymentStatus: "paid",
      razorpayPaymentId: paymentId,
    });
    let propertyWrites = 0;
    t.mock.method(Booking, "findOne", async () => booking);
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
    const booking = makeBooking();
    t.mock.method(Booking, "findOne", async () => booking);
    t.mock.method(Property.collection, "updateOne", async () => ({ matchedCount: 0 }));
    let statusUpdate;
    t.mock.method(Booking, "findOneAndUpdate", async (_filter, update) => {
      statusUpdate = update.$set;
      return { ...booking, ...update.$set };
    });
    t.mock.method(Property, "updateOne", async () => ({}));

    const result = await confirmBookingPayment({ orderId, payment: makePayment() });
    assert.equal(result.status, "refund_pending");
    assert.equal(statusUpdate.paymentStatus, "refund_pending");
    assert.equal(statusUpdate.razorpayPaymentId, paymentId);
    assert.equal(statusUpdate.paid, undefined);
  });
});
