import mongoose from "mongoose";
import { RefundTask } from "../models/refundTaskModel.js";
import { Booking } from "../models/bookingModel.js";
import { Property } from "../models/propertyModel.js";
import {
  createRazorpayRefund,
  getRazorpayInstance,
} from "../utils/razorpay.js";
import crypto from "node:crypto";
import { logger } from "../utils/logger.js";

export const REFUND_LEASE_MS = 2 * 60 * 1000;

const retryDelay = (attempts) =>
  Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempts - 1));

export class RefundManagementError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "RefundManagementError";
    this.statusCode = statusCode;
  }
}

const valueId = (value) => value?._id || value;

export const getBookingCancellationPolicy = () => {
  const configuredHours = process.env.BOOKING_CANCELLATION_CUTOFF_HOURS;
  const cutoffHours =
    configuredHours === undefined ? 24 : Number(configuredHours);
  if (!Number.isFinite(cutoffHours) || cutoffHours < 0 || cutoffHours > 8760) {
    throw new RefundManagementError(
      "Booking cancellation policy is not configured correctly.",
      503
    );
  }
  return { cutoffHours, refundPercentage: 100 };
};

export const assertBookingCancellationEligible = (
  booking,
  now = new Date(),
  cutoffHours = getBookingCancellationPolicy().cutoffHours
) => {
  if (!booking?.paid || booking.paymentStatus !== "paid") {
    throw new RefundManagementError(
      "Only confirmed, paid bookings can be cancelled.",
      409
    );
  }
  if (
    ["refund_pending", "refund_processed", "cancelled"].includes(
      booking.paymentStatus
    ) ||
    ["refund_pending", "cancelled"].includes(booking.cancellationStatus)
  ) {
    throw new RefundManagementError(
      "This booking has already been cancelled or has a refund in progress.",
      409
    );
  }
  const checkIn = new Date(booking.fromDate);
  const cancellationDeadline =
    checkIn.getTime() - cutoffHours * 60 * 60 * 1000;
  if (
    !Number.isFinite(checkIn.getTime()) ||
    now.getTime() > cancellationDeadline
  ) {
    throw new RefundManagementError(
      `Bookings must be cancelled at least ${cutoffHours} hours before check-in.`,
      409
    );
  }
};

const validateRefundPayment = (payment, booking, orderId) => {
  if (
    !payment?.id ||
    payment.id !== booking.razorpayPaymentId ||
    payment.order_id !== orderId ||
    orderId !== booking.razorpayOrderId
  ) {
    throw new RefundManagementError(
      "Razorpay payment does not match this booking.",
      409
    );
  }
  if (
    payment.status !== "captured" ||
    Number(payment.amount) !== Math.round(booking.price * 100) ||
    payment.currency !== "INR"
  ) {
    throw new RefundManagementError(
      "Only the captured INR booking amount can be refunded.",
      409
    );
  }
};

const transactionsUnsupported = (error) =>
  error?.code === 20 ||
  /transaction numbers are only allowed|transactions are not supported|replica set/i.test(
    error?.message || ""
  );

const findInSession = (model, filter, session) => {
  const query = model.findOne(filter);
  return session ? query.session(session) : query;
};

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

const persistRefundIdempotencyKey = async (
  task,
  claimToken,
  { rotate = false, refundId } = {}
) => {
  const idempotencyKey =
    !rotate && task.refundIdempotencyKey
      ? task.refundIdempotencyKey
      : crypto.randomUUID();
  const update = await RefundTask.updateOne(
    {
      _id: task._id,
      status: "processing",
      claimToken,
      leaseExpiresAt: { $gt: new Date() },
    },
    {
      $set: {
        refundIdempotencyKey: idempotencyKey,
        ...(refundId ? { refundId } : {}),
      },
    }
  );
  if (!update.matchedCount) {
    throw new Error("Refund task processing lease is no longer owned.");
  }
  task.refundIdempotencyKey = idempotencyKey;
  if (refundId) task.refundId = refundId;
  return idempotencyKey;
};

export const createRefundTask = async ({
  booking,
  orderId,
  payment,
  session,
  reason = "customer_cancellation",
}) => {
  if (!booking || !orderId || !payment?.id) {
    throw new Error("Refund task requires a booking, order ID, and payment ID.");
  }
  validateRefundPayment(payment, booking, orderId);

  const existing = await findInSession(
    RefundTask,
    { paymentId: payment.id },
    session
  );
  if (existing) {
    if (
      String(existing.booking) !== String(booking._id) ||
      existing.orderId !== orderId ||
      existing.amount !== Number(payment.amount)
    ) {
      throw new RefundManagementError(
        "A refund task already exists for a different booking.",
        409
      );
    }
    return existing;
  }

  const [task] = await RefundTask.create(
    [
      {
        booking: booking._id,
        orderId,
        paymentId: payment.id,
        amount: Number(payment.amount),
        currency: "INR",
        reason,
        status: "pending",
        nextRetryAt: new Date(),
      },
    ],
    session ? { session } : undefined
  );
  return task;
};

export const requestBookingCancellation = async ({
  bookingId,
  userId,
  razorpay,
}) => {
  if (mongoose.connection.readyState !== 1) {
    throw new RefundManagementError(
      "Cancellation is unavailable because the database is not connected.",
      503
    );
  }

  const booking = await Booking.findOne({ _id: bookingId, user: userId });
  if (!booking) {
    throw new RefundManagementError("Booking not found.", 404);
  }

  const policy = getBookingCancellationPolicy();
  assertBookingCancellationEligible(booking, new Date(), policy.cutoffHours);
  if (!booking.razorpayOrderId || !booking.razorpayPaymentId) {
    throw new RefundManagementError(
      "Booking payment details are incomplete.",
      409
    );
  }

  const gateway = razorpay || getRazorpayInstance();
  let payment;
  try {
    payment = await gateway.payments.fetch(booking.razorpayPaymentId);
  } catch {
    throw new RefundManagementError(
      "Unable to verify the payment with Razorpay. Please try again.",
      502
    );
  }
  validateRefundPayment(payment, booking, booking.razorpayOrderId);

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const currentBooking = await findInSession(
        Booking,
        { _id: bookingId, user: userId },
        session
      );
      if (!currentBooking) {
        throw new RefundManagementError("Booking not found.", 404);
      }
      assertBookingCancellationEligible(
        currentBooking,
        new Date(),
        policy.cutoffHours
      );
      validateRefundPayment(
        payment,
        currentBooking,
        currentBooking.razorpayOrderId
      );

      const existingTask = await findInSession(
        RefundTask,
        { paymentId: payment.id },
        session
      );
      if (existingTask) {
        throw new RefundManagementError(
          "A refund has already been requested for this payment.",
          409
        );
      }

      const updatedBooking = await Booking.findOneAndUpdate(
        {
          _id: bookingId,
          user: userId,
          paid: true,
          paymentStatus: "paid",
          razorpayOrderId: payment.order_id,
          razorpayPaymentId: payment.id,
          cancellationStatus: { $nin: ["refund_pending", "cancelled"] },
        },
        {
          $set: {
            paymentStatus: "refund_pending",
            cancellationStatus: "refund_pending",
            cancellationRequestedAt: new Date(),
          },
        },
        { new: true, session }
      );
      if (!updatedBooking) {
        throw new RefundManagementError(
          "This booking is already being cancelled or refunded.",
          409
        );
      }

      const refundTask = await createRefundTask({
        booking: currentBooking,
        orderId: currentBooking.razorpayOrderId,
        payment,
        session,
        reason: "customer_cancellation",
      });

      await Property.updateOne(
        { _id: valueId(currentBooking.property) },
        {
          $pull: {
            currentBookings: { bookingId: currentBooking._id },
            bookingHolds: { bookingId: currentBooking._id },
          },
        },
        { session }
      );
      result = { booking: updatedBooking, refundTask, policy };
    });
    return result;
  } catch (error) {
    if (transactionsUnsupported(error)) {
      throw new RefundManagementError(
        "Cancellation is unavailable because MongoDB transactions are not supported.",
        503
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

export const reconcileRefundTask = async (
  task,
  razorpay = getRazorpayInstance(),
  claimToken = task?.claimToken,
  refundRequest = createRazorpayRefund
) => {
  if (!claimToken || claimToken !== task.claimToken) {
    throw new Error("Refund task claim token is missing or does not match.");
  }
  await assertRefundClaimOwned(task, claimToken);

  const payment = await razorpay.payments.fetch(task.paymentId);
  if (
    payment.id !== task.paymentId ||
    payment.order_id !== task.orderId ||
    Number(payment.amount) !== task.amount ||
    payment.currency !== task.currency ||
    !["captured", "refunded"].includes(payment.status)
  ) {
    throw new Error("Razorpay payment does not match the refund task.");
  }

  const fetchRefund = async (refundId) => {
    const refund = await razorpay.payments.fetchRefund(task.paymentId, refundId);
    if (
      refund.id !== refundId ||
      refund.payment_id !== task.paymentId ||
      Number(refund.amount) !== task.amount ||
      refund.currency !== task.currency
    ) {
      throw new Error("Razorpay refund does not match the refund task.");
    }
    return refund;
  };

  if (task.refundId) {
    const currentRefund = await fetchRefund(task.refundId);
    if (currentRefund.status !== "failed") return currentRefund;
    if (!task.refundIdempotencyKey) {
      await persistRefundIdempotencyKey(task, claimToken, { rotate: true });
    }
  }

  const existing = await razorpay.payments.fetchMultipleRefund(task.paymentId, {
    count: 100,
  });
  const refunds = existing.items || existing || [];
  for (const candidate of refunds) {
    if (!candidate.id || candidate.payment_id !== task.paymentId) {
      continue;
    }
    const refund = await fetchRefund(candidate.id);
    if (refund.status !== "failed") return refund;

    if (
      Number(refund.amount) === task.amount &&
      refund.currency === task.currency
    ) {
      const currentAttemptFailed =
        refund.notes?.homelyhub_refund_attempt ===
        task.refundIdempotencyKey;
      await persistRefundIdempotencyKey(task, claimToken, {
        rotate: !task.refundIdempotencyKey || currentAttemptFailed,
        refundId: refund.id,
      });
    }
  }

  await assertRefundClaimOwned(task, claimToken);
  const idempotencyKey =
    task.refundIdempotencyKey ||
    (await persistRefundIdempotencyKey(task, claimToken));
  const createdRefund = await refundRequest({
    paymentId: task.paymentId,
    amount: task.amount,
    notes: {
      homelyhub_refund_task: String(task._id),
      homelyhub_payment_id: task.paymentId,
      homelyhub_refund_attempt: idempotencyKey,
    },
    receipt: `refund_${task.paymentId}`,
    idempotencyKey,
  });
  if (!createdRefund?.id) {
    throw new Error("Razorpay did not return a refund ID.");
  }
  return fetchRefund(createdRefund.id);
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
    {
      $set: {
        status: "processing",
        leaseExpiresAt: new Date(now.getTime() + REFUND_LEASE_MS),
        claimToken,
        processingStartedAt: now,
        lastError: "",
      },
      $inc: {
        attempts: 1,
      },
    },
    {
      sort: { nextRetryAt: 1, createdAt: 1 },
      returnDocument: "after",
    }
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
      if (mongoose.connection.readyState !== 1) {
        throw new Error("Refund completion requires a database connection.");
      }
      const session = await mongoose.startSession();
      try {
        let completed = false;
        await session.withTransaction(async () => {
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
              $unset: { refundIdempotencyKey: "" },
            },
            { session }
          );
          if (!update.matchedCount) return;

          const bookingUpdate = await Booking.updateOne(
            {
              _id: task.booking,
              razorpayPaymentId: task.paymentId,
              paymentStatus: { $in: ["refund_pending", "refund_processed"] },
            },
            {
              $set: {
                paymentStatus: "refund_processed",
                ...(task.reason === "customer_cancellation"
                  ? {
                      cancellationStatus: "cancelled",
                      cancelledAt: new Date(),
                    }
                  : {}),
              },
            },
            { session }
          );
          if (!bookingUpdate.matchedCount) {
            throw new Error(
              "Refund task was processed but its booking could not be updated."
            );
          }
          completed = true;
        });
        return completed
          ? { status: "processed", refundId: refund.id }
          : { status: "stale" };
      } finally {
        await session.endSession();
      }
    }

    if (refund.status === "failed") {
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
            refundId: refund.id,
            leaseExpiresAt: null,
            claimToken: null,
            nextRetryAt: new Date(Date.now() + retryDelay(task.attempts)),
            lastError: "Razorpay reported that the refund failed.",
          },
          $unset: { refundIdempotencyKey: "" },
        }
      );
      return update.matchedCount
        ? { status: "failed", refundId: refund.id }
        : { status: "stale" };
    }

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
        $unset: { refundIdempotencyKey: "" },
      }
    );
    return update.matchedCount
      ? { status: "pending", refundId: refund.id }
      : { status: "stale" };
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
          nextRetryAt: new Date(Date.now() + retryDelay(task.attempts)),
          lastError: message.slice(0, 2000),
        },
      }
    );
    if (!update.matchedCount) {
      return { status: "stale" };
    }
    logger.error("payment.refund_task_failed", {
      errorName: error.name || "Error",
    });
    return { status: "failed", error: message };
  }
};

export const processRefundWebhook = async ({ eventType, refund, payment }) => {
  if (!["refund.processed", "refund.failed"].includes(eventType)) {
    throw new RefundManagementError("Unsupported refund webhook event.");
  }
  if (mongoose.connection.readyState !== 1) {
    throw new RefundManagementError(
      "Refund webhook processing requires a database connection.",
      503
    );
  }

  const session = await mongoose.startSession();
  try {
    let result = { status: "unmatched" };
    await session.withTransaction(async () => {
      const task = await findInSession(
        RefundTask,
        { paymentId: refund.payment_id },
        session
      );
      if (
        !task ||
        Number(task.amount) !== Number(refund.amount) ||
        task.currency !== refund.currency ||
        payment?.id !== refund.payment_id ||
        payment.order_id !== task.orderId ||
        Number(payment.amount) !== task.amount ||
        payment.currency !== task.currency
      ) {
        return;
      }

      const taskNote = refund.notes?.homelyhub_refund_task;
      const attemptNoteMatches =
        task.status === "processing" &&
        task.refundIdempotencyKey &&
        refund.notes?.homelyhub_refund_attempt ===
          task.refundIdempotencyKey;
      const supersededAttempt =
        task.status === "processing" &&
        task.refundIdempotencyKey &&
        !attemptNoteMatches;
      const matchesTask =
        attemptNoteMatches ||
        (!supersededAttempt &&
          (task.refundId === refund.id ||
            (!task.refundId && taskNote === String(task._id))));
      if (!matchesTask) return;

      if (task.status === "processed") {
        result = { status: "processed", duplicate: true };
        return;
      }

      const now = new Date();
      if (eventType === "refund.failed") {
        const update = await RefundTask.updateOne(
          { _id: task._id, status: { $ne: "processed" } },
          {
            $set: {
              status: "failed",
              refundId: refund.id,
              leaseExpiresAt: null,
              claimToken: null,
              nextRetryAt: new Date(
                now.getTime() + retryDelay(Math.max(1, task.attempts))
              ),
              lastError: "Razorpay reported that the refund failed.",
            },
            $unset: { refundIdempotencyKey: "" },
          },
          { session }
        );
        if (update.matchedCount) result = { status: "failed" };
        return;
      }

      const update = await RefundTask.updateOne(
        { _id: task._id, status: { $ne: "processed" } },
        {
          $set: {
            status: "processed",
            refundId: refund.id,
            leaseExpiresAt: null,
            claimToken: null,
            lastError: "",
          },
          $unset: { refundIdempotencyKey: "" },
        },
        { session }
      );
      if (!update.matchedCount) {
        result = { status: "processed", duplicate: true };
        return;
      }

      const bookingUpdate = await Booking.updateOne(
        {
          _id: task.booking,
          razorpayPaymentId: task.paymentId,
          paymentStatus: { $in: ["refund_pending", "refund_processed"] },
        },
        {
          $set: {
            paymentStatus: "refund_processed",
            ...(task.reason === "customer_cancellation"
              ? {
                  cancellationStatus: "cancelled",
                  cancelledAt: now,
                }
              : {}),
          },
        },
        { session }
      );
      if (!bookingUpdate.matchedCount) {
        throw new RefundManagementError(
          "Refund task could not be matched to its booking.",
          409
        );
      }
      result = { status: "processed" };
    });
    return result;
  } catch (error) {
    if (transactionsUnsupported(error)) {
      throw new RefundManagementError(
        "Refund webhook processing requires MongoDB transaction support.",
        503
      );
    }
    throw error;
  } finally {
    await session.endSession();
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
