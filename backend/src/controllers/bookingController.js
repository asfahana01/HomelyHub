import crypto from "node:crypto";
import { Property } from "../models/propertyModel.js";
import { Booking } from "../models/bookingModel.js";
import { WebhookEvent } from "../models/webhookEventModel.js";
import {
  getRazorpayInstance,
  verifyRazorpaySignature,
  verifyWebhookSignature,
} from "../utils/razorpay.js";
import {
  CHECKOUT_HOLD_MS,
  confirmBookingPayment,
  markPaymentFailed,
  releaseCheckoutHold,
  reserveCheckoutHold,
} from "../services/bookingConfirmationService.js";
import {
  claimWebhookEvent,
  markWebhookEventFailed,
  markWebhookEventProcessed,
} from "../services/webhookEventService.js";
import {
  getBookingCancellationPolicy,
  processRefundWebhook,
  requestBookingCancellation,
} from "../services/refundService.js";
import { parseRazorpayWebhookEvent } from "../utils/validation.js";
import { logger } from "../utils/logger.js";

// Helper: Calculate nights between two dates
const calculateNights = (fromDate, toDate) => {
  const start = new Date(fromDate);
  const end = new Date(toDate);
  const diffTime = end.getTime() - start.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
};

// 1. CREATE ORDER - generates authentic Razorpay order and pending booking record
const createOrder = async (req, res) => {
  try {
    const { propertyId, fromDate, toDate, guests } = req.body;

    if (!propertyId || !fromDate || !toDate || !guests) {
      return res.status(400).json({
        success: false,
        message: "Property, check-in date, check-out date, and guest count are required.",
      });
    }

    // 1. Fetch property from MongoDB
    const property = await Property.findById(propertyId);
    if (!property || property.isArchived || property.isActive === false) {
      return res.status(404).json({
        success: false,
        message: "Property not found or is currently unavailable.",
      });
    }

    // 2. Validate dates
    const checkin = new Date(fromDate);
    const checkout = new Date(toDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (isNaN(checkin.getTime()) || isNaN(checkout.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid check-in or check-out date format.",
      });
    }

    if (checkin < today) {
      return res.status(400).json({
        success: false,
        message: "Check-in date cannot be in the past.",
      });
    }

    const nights = calculateNights(checkin, checkout);
    if (nights < 1) {
      return res.status(400).json({
        success: false,
        message: "Check-out date must be at least one day after check-in date.",
      });
    }

    // 3. Validate guest count
    const guestNum = parseInt(guests, 10);
    if (!Number.isInteger(guestNum) || guestNum < 1 || guestNum > property.maximumGuest) {
      return res.status(400).json({
        success: false,
        message: `Guest count must be between 1 and ${property.maximumGuest}.`,
      });
    }

    // 5. Server-side price calculation (Never trust client-provided amount!)
    const calculatedPrice = nights * property.price;
    const amountInPaise = Math.round(calculatedPrice * 100);

    // Create a booking-backed hold before asking Razorpay to create the order.
    const holdExpiresAt = new Date(Date.now() + CHECKOUT_HOLD_MS);
    const pendingBooking = await Booking.create({
      user: req.user._id,
      property: property._id,
      price: calculatedPrice,
      fromDate: checkin,
      toDate: checkout,
      guests: guestNum,
      numberOfnights: nights,
      paid: false,
      paymentStatus: "pending",
      holdExpiresAt,
    });

    let heldProperty;
    try {
      heldProperty = await reserveCheckoutHold(pendingBooking, holdExpiresAt);
    } catch (error) {
      await Booking.deleteOne({ _id: pendingBooking._id });
      throw error;
    }

    if (!heldProperty) {
      await Booking.deleteOne({ _id: pendingBooking._id });
      return res.status(409).json({
        success: false,
        message: "Property is already booked or held for the selected dates.",
      });
    }

    let razorpayOrder;
    try {
      const razorpay = getRazorpayInstance();
      razorpayOrder = await razorpay.orders.create({
        amount: amountInPaise,
        currency: "INR",
        receipt: `rcpt_${Date.now()}_${String(req.user._id).slice(-4)}`,
        notes: {
          propertyId: String(property._id),
          userId: String(req.user._id),
          nights: String(nights),
        },
      });
    } catch (rzpErr) {
      await releaseCheckoutHold(pendingBooking);
      await Booking.updateOne(
        { _id: pendingBooking._id },
        { $set: { paymentStatus: "cancelled" } }
      );
      logger.error("payment.order_creation_failed", {
        requestId: req.requestId,
        errorName: rzpErr.name || "Error",
      });
      return res.status(502).json({
        success: false,
        message: "Unable to initiate payment with payment gateway. Please try again later.",
      });
    }

    try {
      const linkResult = await Booking.updateOne(
        { _id: pendingBooking._id },
        { $set: { razorpayOrderId: razorpayOrder.id } }
      );
      if (!linkResult.matchedCount) {
        throw new Error("Pending booking disappeared before order linkage.");
      }
    } catch (persistenceError) {
      logger.error("payment.order_link_failed", {
        requestId: req.requestId,
        errorName: persistenceError.name || "Error",
      });
      return res.status(503).json({
        success: false,
        message:
          "The payment order could not be linked to your booking. Please contact support before retrying.",
      });
    }

    res.status(201).json({
      success: true,
      message: "Order created successfully",
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount, // in paise for Razorpay Checkout
      currency: razorpayOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      propertyName: property.propertyName,
      bookingId: pendingBooking._id,
      nights,
      calculatedPrice,
    });
  } catch (error) {
    logger.error("payment.order_request_failed", {
      requestId: req.requestId,
      errorName: error.name || "Error",
    });
    res.status(500).json({
      success: false,
      message: "Failed to create booking order",
    });
  }
};

// 2. VERIFY PAYMENT - verifies Razorpay signature server-side and marks booking paid
const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Missing required payment verification parameters.",
      });
    }

    const isValidSignature = verifyRazorpaySignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });

    if (!isValidSignature) {
      logger.warn("security.payment.signature_rejected", {
        requestId: req.requestId,
      });
      return res.status(400).json({
        success: false,
        message: "Payment verification failed: Invalid cryptographic signature.",
      });
    }

    const razorpay = getRazorpayInstance();
    let payment;
    try {
      payment = await razorpay.payments.fetch(razorpay_payment_id);
    } catch (fetchErr) {
      logger.error("payment.gateway_fetch_failed", {
        requestId: req.requestId,
        errorName: fetchErr.name || "Error",
      });
      return res.status(502).json({
        success: false,
        message: "Unable to verify payment with Razorpay. Please try again.",
      });
    }

    const result = await confirmBookingPayment({
      orderId: razorpay_order_id,
      payment,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
      userId: req.user._id,
    });

    if (result.status === "refund_pending") {
      logger.error("payment.booking_confirmation_refund_pending", {
        requestId: req.requestId,
      });
      return res.status(409).json({
        success: false,
        message:
          "Payment was captured, but the dates are no longer available. A refund is pending; please contact support.",
        booking: result.booking,
      });
    }

    res.status(200).json({
      success: true,
      message: result.alreadyConfirmed
        ? "Payment already verified and booking is confirmed."
        : "Payment successful and booking confirmed!",
      booking: result.booking,
    });
  } catch (error) {
    logger.error("payment.verification_failed", {
      requestId: req.requestId,
      errorName: error.name || "Error",
    });
    res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.statusCode && error.statusCode < 500
          ? error.message
          : "Payment verification error occurred",
    });
  }
};

// 3. RAZORPAY WEBHOOK - Idempotent, signature-verified webhook handler
const razorpayWebhook = async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const rawBody = req.rawBody;

  if (!signature || !Buffer.isBuffer(rawBody)) {
    return res.status(400).json({
      status: "fail",
      message: "Missing webhook signature or payload",
    });
  }

  if (!verifyWebhookSignature({ rawBody, signature })) {
    logger.warn("security.payment.webhook_signature_rejected", {
      requestId: req.requestId,
    });
    return res.status(400).json({
      status: "fail",
      message: "Invalid webhook signature",
    });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({
      status: "fail",
      message: "Invalid webhook payload",
    });
  }

  try {
    event = parseRazorpayWebhookEvent(event);
  } catch {
    return res.status(400).json({
      status: "fail",
      message: "Invalid webhook payload",
    });
  }

  const eventType = event.event;
  const eventId =
    req.headers["x-razorpay-event-id"] ||
    crypto.createHash("sha256").update(rawBody).digest("hex");

  let claim;
  try {
    claim = await claimWebhookEvent({ eventId, eventType });
  } catch (error) {
    logger.error("payment.webhook_claim_failed", {
      requestId: req.requestId,
      errorName: error.name || "Error",
    });
    return res.status(503).json({
      status: "error",
      message: "Webhook event could not be claimed",
    });
  }

  if (!claim.claimed) {
    return res.status(200).json({ status: "success" });
  }
  const { claimToken } = claim;

  try {
    if (eventType === "payment.captured") {
      const payment = event.payload?.payment?.entity;
      if (!payment?.order_id || !payment?.id) {
        throw new BookingConfirmationError(
          "Webhook payment details are incomplete",
          400
        );
      }

      await confirmBookingPayment({
        orderId: payment.order_id,
        payment,
      });
    } else if (eventType === "payment.failed") {
      const payment = event.payload?.payment?.entity;
      if (!payment?.order_id) {
        throw new BookingConfirmationError(
          "Webhook failed-payment details are incomplete",
          400
        );
      }
      await markPaymentFailed({ orderId: payment.order_id });
    } else if (
      eventType === "refund.processed" ||
      eventType === "refund.failed"
    ) {
      const refund = event.payload?.refund?.entity;
      const payment = event.payload?.payment?.entity;
      const result = await processRefundWebhook({
        eventType,
        refund,
        payment,
      });
      if (result.status === "unmatched") {
        logger.warn("payment.refund_webhook_unmatched", {
          requestId: req.requestId,
        });
      }
    }

    await markWebhookEventProcessed(eventId, claimToken);
    return res.status(200).json({ status: "success" });
  } catch (error) {
    await markWebhookEventFailed(eventId, claimToken, error);
    logger.error("payment.webhook_processing_failed", {
      requestId: req.requestId,
      errorName: error.name || "Error",
    });
    return res.status(error.statusCode || 500).json({
      status: error.statusCode && error.statusCode < 500 ? "fail" : "error",
      message:
        error.statusCode && error.statusCode < 500
          ? error.message
          : "Webhook processing failed; the event will be retried",
    });
  }
};

const cancelBooking = async (req, res) => {
  try {
    const result = await requestBookingCancellation({
      bookingId: req.params.bookingId,
      userId: req.user._id,
    });
    return res.status(202).json({
      success: true,
      message: "Cancellation accepted. Your refund is being processed.",
      data: {
        booking: result.booking,
        refund: {
          status: "pending",
          amount: result.refundTask.amount / 100,
          currency: result.refundTask.currency,
        },
        cancellationPolicy: result.policy,
      },
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    logger.warn("booking.cancellation_request_failed", {
      requestId: req.requestId,
      statusCode,
      errorName: error.name || "Error",
    });
    return res.status(statusCode).json({
      success: false,
      message:
        statusCode < 500
          ? error.message
          : "Unable to process cancellation right now. Please try again.",
    });
  }
};

// 4. GET MY BOOKINGS - retrieve authenticated user's confirmed bookings
const getUserBookings = async (req, res) => {
  try {
    const bookings = await Booking.find({
      user: req.user._id,
      paid: true,
    }).sort("-createdAt");

    res.status(200).json({
      status: "success",
      data: {
        bookings,
        cancellationPolicy: getBookingCancellationPolicy(),
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: "Failed to fetch bookings",
    });
  }
};

// 5. GET ONE BOOKING DETAILS - Fixed IDOR vulnerability: requires both booking ID and matching user ID
const getBookingDetails = async (req, res) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.bookingId,
      user: req.user._id,
    });

    if (!booking) {
      logger.warn("security.booking.access_denied", {
        requestId: req.requestId,
      });
      return res.status(404).json({
        status: "fail",
        message: "Booking not found",
      });
    }

    res.status(200).json({
      status: "success",
      data: {
        bookings: booking,
        cancellationPolicy: getBookingCancellationPolicy(),
      },
    });
  } catch (error) {
    res.status(404).json({
      status: "fail",
      message: "Booking not found",
    });
  }
};

export {
  getBookingDetails,
  getUserBookings,
  createOrder,
  verifyPayment,
  razorpayWebhook,
  cancelBooking,
};
