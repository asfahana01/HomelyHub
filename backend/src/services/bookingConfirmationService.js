import mongoose from "mongoose";
import { Booking } from "../models/bookingModel.js";
import { Property } from "../models/propertyModel.js";
import { RefundTask } from "../models/refundTaskModel.js";

export const CHECKOUT_HOLD_MS = 15 * 60 * 1000;

export class BookingConfirmationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "BookingConfirmationError";
    this.statusCode = statusCode;
  }
}

const documentId = (value) => value?._id || value;

export const validateCapturedPayment = (
  payment,
  booking,
  expectedOrderId,
  expectedPaymentId
) => {
  if (!payment || !booking || !payment.id) {
    throw new BookingConfirmationError("Payment details are incomplete.");
  }
  if (
    payment.order_id !== expectedOrderId ||
    booking.razorpayOrderId !== expectedOrderId
  ) {
    throw new BookingConfirmationError("Payment does not belong to this order.");
  }
  if (expectedPaymentId && payment.id !== expectedPaymentId) {
    throw new BookingConfirmationError("Payment ID does not match the verified payment.");
  }
  if (payment.status !== "captured") {
    throw new BookingConfirmationError("Payment has not been captured yet.");
  }
  if (
    Number(payment.amount) !== Math.round(booking.price * 100) ||
    payment.currency !== "INR"
  ) {
    throw new BookingConfirmationError("Payment amount or currency mismatch.");
  }
};

const availabilityFilter = (propertyId, booking, now) => ({
  _id: documentId(propertyId),
  isArchived: { $ne: true },
  isActive: { $ne: false },
  currentBookings: {
    $not: {
      $elemMatch: {
        bookingId: { $ne: booking._id },
        fromDate: { $lt: booking.toDate },
        toDate: { $gt: booking.fromDate },
      },
    },
  },
  bookingHolds: {
    $not: {
      $elemMatch: {
        bookingId: { $ne: booking._id },
        fromDate: { $lt: booking.toDate },
        toDate: { $gt: booking.fromDate },
        expiresAt: { $gt: now },
      },
    },
  },
});

export const reserveCheckoutHold = async (booking, expiresAt) => {
  const now = new Date();
  const hold = {
    bookingId: booking._id,
    fromDate: booking.fromDate,
    toDate: booking.toDate,
    userId: documentId(booking.user),
    expiresAt,
  };
  const result = await Property.collection.updateOne(
    availabilityFilter(booking.property, booking, now),
    [
      {
        $set: {
          bookingHolds: {
            $concatArrays: [
              {
                $filter: {
                  input: { $ifNull: ["$bookingHolds", []] },
                  as: "hold",
                  cond: { $gt: ["$$hold.expiresAt", now] },
                },
              },
              [hold],
            ],
          },
        },
      },
    ]
  );
  return result && result.matchedCount ? result : null;
};

export const releaseCheckoutHold = async (booking) =>
  Property.updateOne(
    { _id: booking.property },
    { $pull: { bookingHolds: { bookingId: booking._id } } }
  );

const confirmWithTransaction = async (
  { orderId, payment, paymentId, signature, userId },
  session
) => {
  const booking = await Booking.findOne({
    razorpayOrderId: orderId,
    ...(userId ? { user: userId } : {}),
  }).session(session);

  if (!booking) {
    throw new BookingConfirmationError(
      "No matching booking found for this order.",
      404
    );
  }

  validateCapturedPayment(payment, booking, orderId, paymentId);

  if (booking.paid && booking.paymentStatus === "paid") {
    if (booking.razorpayPaymentId !== payment.id) {
      throw new BookingConfirmationError(
        "This booking was confirmed with a different payment.",
        409
      );
    }
    return { status: "confirmed", booking, alreadyConfirmed: true };
  }

  if (booking.razorpayPaymentId && booking.razorpayPaymentId !== payment.id) {
    throw new BookingConfirmationError(
      "This booking is associated with a different payment.",
      409
    );
  }

  if (
    booking.paymentStatus === "confirming" &&
    booking.confirmingPaymentId === payment.id
  ) {
    throw new BookingConfirmationError(
      "Payment confirmation is already being processed.",
      409
    );
  }

  if (
    ["refund_pending", "refund_processed"].includes(booking.paymentStatus)
  ) {
    if (booking.razorpayPaymentId === payment.id) {
      return { status: "refund_pending", booking };
    }
    throw new BookingConfirmationError(
      "This booking is already awaiting or completed refund processing.",
      409
    );
  }

  const claimed = await Booking.findOneAndUpdate(
    {
      _id: booking._id,
      paid: false,
      razorpayOrderId: orderId,
      $or: [
        { razorpayPaymentId: { $exists: false } },
        { razorpayPaymentId: null },
        { razorpayPaymentId: payment.id },
      ],
      paymentStatus: { $nin: ["paid", "refund_pending", "refund_processed"] },
    },
    {
      $set: {
        paymentStatus: "confirming",
        confirmingPaymentId: payment.id,
        razorpayPaymentId: payment.id,
        ...(signature ? { razorpaySignature: signature } : {}),
      },
    },
    { new: true, session }
  );

  if (!claimed) {
    const latest = await Booking.findById(booking._id).session(session);
    if (latest?.paid && latest.razorpayPaymentId === payment.id) {
      return { status: "confirmed", booking: latest, alreadyConfirmed: true };
    }
    throw new BookingConfirmationError(
      "This booking is already being confirmed by another payment.",
      409
    );
  }

  const now = new Date();
  const propertyUpdate = await Property.collection.updateOne(
    availabilityFilter(claimed.property, claimed, now),
    {
      $pull: { bookingHolds: { bookingId: claimed._id } },
      $addToSet: {
        currentBookings: {
          bookingId: claimed._id,
          fromDate: claimed.fromDate,
          toDate: claimed.toDate,
          userId: documentId(claimed.user),
        },
      },
    },
    { session }
  );

  if (!propertyUpdate.matchedCount) {
    await Booking.findOneAndUpdate(
      {
        _id: claimed._id,
        paymentStatus: "confirming",
        confirmingPaymentId: payment.id,
      },
      {
        $set: {
          paid: false,
          paymentStatus: "refund_pending",
          confirmingPaymentId: null,
          razorpayPaymentId: payment.id,
          ...(signature ? { razorpaySignature: signature } : {}),
        },
      },
      { session }
    );

    await RefundTask.updateOne(
      { paymentId: payment.id },
      {
        $setOnInsert: {
          booking: claimed._id,
          orderId,
          paymentId: payment.id,
          amount: Number(payment.amount),
          currency: "INR",
        },
        $set: {
          status: "pending",
          nextRetryAt: new Date(),
          leaseExpiresAt: null,
          lastError: "",
        },
      },
      { upsert: true, session }
    );

    await Property.updateOne(
      { _id: documentId(claimed.property) },
      { $pull: { bookingHolds: { bookingId: claimed._id } } },
      { session }
    );

    const refundBooking = await Booking.findById(claimed._id).session(session);
    return { status: "refund_pending", booking: refundBooking };
  }

  const confirmed = await Booking.findOneAndUpdate(
    {
      _id: claimed._id,
      paymentStatus: "confirming",
      confirmingPaymentId: payment.id,
      paid: false,
    },
    {
      $set: {
        paid: true,
        paymentStatus: "paid",
        confirmingPaymentId: null,
        razorpayPaymentId: payment.id,
      },
    },
    { new: true, session }
  );

  if (!confirmed) {
    throw new BookingConfirmationError(
      "Booking confirmation state changed unexpectedly.",
      409
    );
  }
  return { status: "confirmed", booking: confirmed, alreadyConfirmed: false };
};

export const confirmBookingPayment = async (details) => {
  if (mongoose.connection.readyState !== 1) {
    throw new BookingConfirmationError(
      "Payment confirmation unavailable: database is not connected.",
      503
    );
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await confirmWithTransaction(details, session);
    });
    return result;
  } catch (error) {
    if (
      error?.code === 20 ||
      /transaction numbers are only allowed|transactions are not supported|replica set/i.test(
        error?.message || ""
      )
    ) {
      console.error(
        "Payment confirmation refused because MongoDB transactions are unavailable. Replica-set deployment required."
      );
      throw new BookingConfirmationError(
        "Payment confirmation is unavailable because MongoDB transactions are not supported. Please retry in a supported deployment.",
        503
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

export const markPaymentFailed = async ({ orderId }) => {
  const booking = await Booking.findOneAndUpdate(
    {
      razorpayOrderId: orderId,
      paid: false,
      paymentStatus: { $in: ["pending", "authorized"] },
    },
    { $set: { paymentStatus: "failed" } },
    { new: true }
  );
  if (booking) {
    await releaseCheckoutHold(booking);
  }
  return booking;
};

export { confirmWithTransaction };