import { RefundTask } from "../models/refundTaskModel.js";
import { Booking } from "../models/bookingModel.js";
import { getRazorpayInstance } from "../utils/razorpay.js";
import crypto from "node:crypto";

export const REFUND_LEASE_MS = 2 * 60 * 1000;

const retryDelay = (attempts) =>
  Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempts - 1));

const assertRefundClaimOwned = async (task, claimToken) => {
  const owned = await RefundTask.exists({
    _id: task._id,
    status: "processing",
    claimToken,
    leaseExpiresAt: { $gt: new Date() },
  });
  if (!owned) {
    throw new Error("Refund task processing lease is no longer owned.");
  }
};

export const createRefundTask = async ({
  booking,
  orderId,
  payment,
}) => {
  if (!booking || !orderId || !payment?.id) {
    throw new Error("Refund task requires a booking, order ID, and payment ID.");
  }
  if (Number(payment.amount) !== Math.round(booking.price * 100)) {
    throw new Error("Refund amount does not match the captured booking amount.");
  }
  if (payment.currency !== "INR") {
    throw new Error("Refund currency must be INR.");
  }

  await Booking.findOneAndUpdate(
    { _id: booking._id, paid: false },
    {
      $set: {
        paymentStatus: "refund_pending",
        razorpayOrderId: orderId,
        razorpayPaymentId: payment.id,
      },
    }
  );

  await RefundTask.updateOne(
    { paymentId: payment.id },
    {
      $setOnInsert: {
        booking: booking._id,
        orderId,
        paymentId: payment.id,
        amount: Number(payment.amount),
        currency: "INR",
      },
      $set: {
        status: "pending",
        nextRetryAt: new Date(),
      },
    },
    { upsert: true }
  );

  await Booking.updateOne(
    { _id: booking._id },
    { $set: { holdExpiresAt: new Date(0) } }
  );
};

export const reconcileRefundTask = async (
  task,
  razorpay = getRazorpayInstance(),
  claimToken = task?.claimToken
) => {
  if (!claimToken || claimToken !== task.claimToken) {
    throw new Error("Refund task claim token is missing or does not match.");
  }
  await assertRefundClaimOwned(task, claimToken);

  const payment = await razorpay.payments.fetch(task.paymentId);
  if (payment.status !== "captured" && payment.status !== "refunded") {
    throw new Error(`Payment ${task.paymentId} is not captured/refunded.`);
  }

  if (task.refundId) {
    const refund = await razorpay.payments.fetchRefund(
      task.paymentId,
      task.refundId
    );
    if (refund.status === "processed") return refund;
    if (refund.status !== "failed") return refund;
  }

  const existing = await razorpay.payments.fetchMultipleRefund(task.paymentId, {
    count: 100,
  });
  const refunds = existing.items || existing || [];
  const match = refunds.find(
    (refund) =>
      refund.payment_id === task.paymentId &&
      Number(refund.amount) === task.amount &&
      refund.currency === "INR" &&
      refund.status !== "failed"
  );
  if (match) return match;

  await assertRefundClaimOwned(task, claimToken);
  return razorpay.payments.refund(task.paymentId, {
    amount: task.amount,
    speed: "normal",
    notes: {
      homelyhub_refund_task: String(task._id),
      homelyhub_payment_id: task.paymentId,
    },
    receipt: `refund_${task.paymentId}`,
  });
};

export const claimRefundTask = async (now = new Date()) => {
  const maxAttempts = Number(process.env.REFUND_MAX_ATTEMPTS) || 10;
  const claimToken = crypto.randomUUID();
  return RefundTask.findOneAndUpdate(
    {
      status: { $in: ["pending", "processing", "failed"] },
      attempts: { $lt: maxAttempts },
      nextRetryAt: { $lte: now },
      $or: [
        { status: { $ne: "processing" } },
        { leaseExpiresAt: { $lte: now } },
      ],
    },
    [
      {
        $set: {
          status: "processing",
          leaseExpiresAt: new Date(Date.now() + REFUND_LEASE_MS),
          claimToken,
          processingStartedAt: now,
          attempts: { $add: ["$attempts", 1] },
          lastError: "",
        },
      },
    ],
    { sort: { nextRetryAt: 1, createdAt: 1 }, returnDocument: "after" }
  );
};

export const processRefundTask = async (
  task,
  reconcile = reconcileRefundTask
) => {
  const claimToken = task?.claimToken;
  if (!task?._id || !claimToken) {
    return { status: "stale", error: "Refund task claim token is missing." };
  }

  try {
    const refund = await reconcile(task, undefined, claimToken);
    if (!refund) {
      const update = await RefundTask.updateOne(
        {
          _id: task._id,
          status: "processing",
          claimToken,
          leaseExpiresAt: { $gt: new Date() },
        },
        {
          $set: {
            status: "pending",
            leaseExpiresAt: null,
            claimToken: null,
            nextRetryAt: new Date(Date.now() + retryDelay(task.attempts)),
          },
        }
      );
      return update.matchedCount
        ? { status: "pending" }
        : { status: "stale" };
    }

    if (refund.status === "processed") {
      const update = await RefundTask.updateOne(
        {
          _id: task._id,
          status: "processing",
          claimToken,
          leaseExpiresAt: { $gt: new Date() },
        },
        {
          $set: {
            status: "processed",
            refundId: refund.id,
            leaseExpiresAt: null,
            claimToken: null,
            lastError: "",
          },
        }
      );
      if (!update.matchedCount) return { status: "stale" };

      await Booking.updateOne(
        {
          _id: task.booking,
          razorpayPaymentId: task.paymentId,
        },
        { $set: { paymentStatus: "refund_processed" } }
      );
      return { status: "processed", refundId: refund.id };
    }

    if (refund.status === "pending") {
      const update = await RefundTask.updateOne(
        {
          _id: task._id,
          status: "processing",
          claimToken,
          leaseExpiresAt: { $gt: new Date() },
        },
        {
          $set: {
            status: "pending",
            refundId: refund.id,
            leaseExpiresAt: null,
            claimToken: null,
            nextRetryAt: new Date(Date.now() + retryDelay(task.attempts)),
            lastError: "",
          },
        }
      );
      return update.matchedCount
        ? { status: "pending", refundId: refund.id }
        : { status: "stale" };
    }

    throw new Error(`Razorpay refund returned status ${refund.status}.`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown refund processing error";
    const update = await RefundTask.updateOne(
      {
        _id: task._id,
        status: "processing",
        claimToken,
        leaseExpiresAt: { $gt: new Date() },
      },
      {
        $set: {
          status: "failed",
          leaseExpiresAt: null,
          claimToken: null,
          refundId: null,
          nextRetryAt: new Date(Date.now() + retryDelay(task.attempts)),
          lastError: message.slice(0, 2000),
        },
      }
    );
    if (!update.matchedCount) {
      return { status: "stale" };
    }
    console.error(
      `Refund task ${task._id} failed for payment ${task.paymentId}: ${message}`
    );
    return { status: "failed", error: message };
  }
};

export const runRefundWorkerOnce = async () => {
  let processed = 0;
  for (;;) {
    const task = await claimRefundTask();
    if (!task) break;
    await processRefundTask(task);
    processed += 1;
  }
  return processed;
};
