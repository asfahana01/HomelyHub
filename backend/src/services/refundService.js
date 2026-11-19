import { RefundTask } from "../models/refundTaskModel.js";
import { Booking } from "../models/bookingModel.js";
import { getRazorpayInstance } from "../utils/razorpay.js";

export const REFUND_LEASE_MS = 2 * 60 * 1000;

const retryDelay = (attempts) =>
  Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempts - 1));

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
  razorpay = getRazorpayInstance()
) => {
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
    if (refund.status === "failed") {
      throw new Error(`Razorpay refund ${task.refundId} failed.`);
    }
    return refund;
  }

  const existing = await razorpay.payments.fetchMultipleRefund(task.paymentId, {
    count: 100,
  });
  const refunds = existing.items || existing || [];
  const match = refunds.find(
    (refund) =>
      refund.payment_id === task.paymentId &&
      Number(refund.amount) === task.amount &&
      refund.currency === "INR"
  );
  if (match) return match;

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
          processingStartedAt: now,
          attempts: { $add: ["$attempts", 1] },
          lastError: "",
        },
      },
    ],
    { sort: { nextRetryAt: 1, createdAt: 1 }, new: true }
  );
};

export const processRefundTask = async (task) => {
  try {
    const refund = await reconcileRefundTask(task);
    if (!refund) return { status: "pending" };

    if (refund.status === "processed") {
      await RefundTask.updateOne(
        {
          _id: task._id,
          status: "processing",
          leaseExpiresAt: { $gt: new Date() },
        },
        {
          $set: {
            status: "processed",
            refundId: refund.id,
            leaseExpiresAt: null,
            lastError: "",
          },
        }
      );
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
      await RefundTask.updateOne(
        { _id: task._id, status: "processing" },
        {
          $set: {
            status: "pending",
            refundId: refund.id,
            leaseExpiresAt: null,
            nextRetryAt: new Date(Date.now() + retryDelay(task.attempts)),
            lastError: "",
          },
        }
      );
      return { status: "pending", refundId: refund.id };
    }

    throw new Error(`Razorpay refund returned status ${refund.status}.`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown refund processing error";
    await RefundTask.updateOne(
      { _id: task._id, status: "processing" },
      {
        $set: {
          status: "failed",
          leaseExpiresAt: null,
          nextRetryAt: new Date(Date.now() + retryDelay(task.attempts)),
          lastError: message.slice(0, 2000),
        },
      }
    );
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
