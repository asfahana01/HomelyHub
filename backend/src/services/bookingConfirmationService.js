import mongoose from "mongoose";
import { Booking } from "../models/bookingModel.js";
import { Property } from "../models/propertyModel.js";

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

const isTransactionUnavailable = (error) =>
  error?.code === 20 ||
  /transaction numbers are only allowed|transactions are not supported|replica set/i.test(
    error?.message || ""
  );

const withSession = (query, session) =>
  session ? query.session(session) : query;

const confirmWithDatabase = async (
  { orderId, payment, paymentId, signature, userId },
  session
) => {
  const bookingQuery = Booking.findOne({
    razorpayOrderId: orderId,
    ...(userId ? { user: userId } : {}),
  });
  const booking = await withSession(bookingQuery, session);

  if (!booking) {
    throw new BookingConfirmationError("No matching booking found for this order.", 404);
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

  if (booking.paymentStatus === "refund_pending") {
    if (booking.razorpayPaymentId !== payment.id) {
      throw new BookingConfirmationError(
        "A refund is pending for a different payment.",
        409
      );
    }
    return { status: "refund_pending", booking };
  }

  const now = new Date();
  const updatedPropertyResult = await Property.collection.updateOne(
    availabilityFilter(booking.property, booking, now),
    {
      $pull: {
        bookingHolds: { bookingId: booking._id },
      },
      $addToSet: {
        currentBookings: {
          bookingId: booking._id,
          fromDate: booking.fromDate,
          toDate: booking.toDate,
          userId: documentId(booking.user),
        },
      },
    },
    session ? { session } : {}
  );

  if (!updatedPropertyResult.matchedCount) {
    const refundBookingQuery = Booking.findOneAndUpdate(
      { _id: booking._id, paid: false },
      {
        $set: {
          paymentStatus: "refund_pending",
          razorpayPaymentId: payment.id,
          ...(signature ? { razorpaySignature: signature } : {}),
        },
      },
      { new: true, session }
    );
    const refundBooking = await refundBookingQuery;
    await Property.updateOne(
      { _id: booking.property },
      { $pull: { bookingHolds: { bookingId: booking._id } } },
      { session }
    );
    return { status: "refund_pending", booking: refundBooking || booking };
  }

  let confirmedBooking;
  try {
    confirmedBooking = await Booking.findOneAndUpdate(
      { _id: booking._id, paid: false, paymentStatus: { $ne: "refund_pending" } },
      {
        $set: {
          paid: true,
          paymentStatus: "paid",
          razorpayPaymentId: payment.id,
          ...(signature ? { razorpaySignature: signature } : {}),
        },
      },
      { new: true, session }
    );
  } catch (error) {
    if (!session) {
      const latestBooking = await Booking.findById(booking._id);
      if (latestBooking && !latestBooking.paid) {
        await Property.updateOne(
          { _id: documentId(booking.property) },
          { $pull: { currentBookings: { bookingId: booking._id } } }
        );
      }
    }
    throw error;
  }

  if (!confirmedBooking) {
    const latestBookingQuery = Booking.findById(booking._id);
    const latestBooking = await withSession(latestBookingQuery, session);
    if (
      latestBooking?.paid &&
      latestBooking.razorpayPaymentId === payment.id
    ) {
      return { status: "confirmed", booking: latestBooking, alreadyConfirmed: true };
    }
    if (!session) {
      await Property.updateOne(
        { _id: documentId(booking.property) },
        { $pull: { currentBookings: { bookingId: booking._id } } }
      );
    }
    throw new BookingConfirmationError(
      "The payment was captured, but booking confirmation needs recovery.",
      503
    );
  }

  return { status: "confirmed", booking: confirmedBooking, alreadyConfirmed: false };
};

export const confirmBookingPayment = async (details) => {
  if (mongoose.connection.readyState !== 1) {
    return confirmWithDatabase(details, null);
  }

  let session;
  try {
    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      result = await confirmWithDatabase(details, session);
    });
    return result;
  } catch (error) {
    if (!isTransactionUnavailable(error)) {
      throw error;
    }
    return confirmWithDatabase(details, null);
  } finally {
    if (session) await session.endSession();
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