import { Property } from "../models/propertyModel.js";
import { Booking } from "../models/bookingModel.js";
import {
  getRazorpayInstance,
  verifyRazorpaySignature,
  verifyWebhookSignature,
} from "../utils/razorpay.js";

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

    // 4. Check date availability against confirmed bookings
    const isOverlapping = (property.currentBookings || []).some((booking) => {
      const bFrom = new Date(booking.fromDate);
      const bTo = new Date(booking.toDate);
      return bFrom < checkout && bTo > checkin;
    });

    if (isOverlapping) {
      return res.status(400).json({
        success: false,
        message: "Property is already booked for the selected dates.",
      });
    }

    // 5. Server-side price calculation (Never trust client-provided amount!)
    const calculatedPrice = nights * property.price;
    const amountInPaise = Math.round(calculatedPrice * 100);

    // 6. Create Razorpay order
    const razorpay = getRazorpayInstance();
    let razorpayOrder;

    try {
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
      console.error("Razorpay order creation failed:", rzpErr);
      return res.status(502).json({
        success: false,
        message: "Unable to initiate payment with payment gateway. Please try again later.",
      });
    }

    // 7. Store pending booking in MongoDB
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
      razorpayOrderId: razorpayOrder.id,
    });

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
    console.error("createOrder error:", error);
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

    // 1. Find pending booking by server-generated order ID and authenticated user
    const booking = await Booking.findOne({
      razorpayOrderId: razorpay_order_id,
      user: req.user._id,
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "No matching booking found for this order and user.",
      });
    }

    // 2. Idempotency check: if already confirmed/paid, return success
    if (booking.paid && booking.paymentStatus === "paid") {
      return res.status(200).json({
        success: true,
        message: "Payment already verified and booking is confirmed.",
        booking,
      });
    }

    // 3. Cryptographically verify signature using timing-safe comparison
    const isValidSignature = verifyRazorpaySignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });

    if (!isValidSignature) {
      booking.paymentStatus = "failed";
      await booking.save();
      return res.status(400).json({
        success: false,
        message: "Payment verification failed: Invalid cryptographic signature.",
      });
    }

    
// Fetch payment details directly from Razorpay
const razorpay = getRazorpayInstance();

let payment;

try {
  payment = await razorpay.payments.fetch(razorpay_payment_id);
} catch (fetchErr) {
  console.error("Razorpay payment fetch failed:", fetchErr.message);

  return res.status(502).json({
    success: false,
    message: "Unable to verify payment with Razorpay. Please try again.",
  });
}

// Verify payment belongs to the expected order
if (payment.order_id !== razorpay_order_id) {
  return res.status(400).json({
    success: false,
    message: "Payment does not belong to this order.",
  });
}

// Only captured payments are treated as successful
if (payment.status !== "captured") {
  return res.status(400).json({
    success: false,
    message: "Payment has not been captured yet.",
  });
}

// Verify exact amount and currency
const expectedPaise = Math.round(booking.price * 100);

if (
  Number(payment.amount) !== expectedPaise ||
  payment.currency !== "INR"
) {
  return res.status(400).json({
    success: false,
    message: "Payment amount or currency mismatch.",
  });
}


    // 5. Atomic property booking date reservation to prevent race conditions
    const updatedProperty = await Property.findOneAndUpdate(
      {
        _id: booking.property,
        currentBookings: {
          $not: {
            $elemMatch: {
              fromDate: { $lt: booking.toDate },
              toDate: { $gt: booking.fromDate },
            },
          },
        },
      },
      {
        $push: {
          currentBookings: {
            bookingId: booking._id,
            fromDate: booking.fromDate,
            toDate: booking.toDate,
            userId: req.user._id,
          },
        },
      },
      { new: true }
    );

    if (!updatedProperty) {
      // Conflicting booking occurred during payment
      booking.paymentStatus = "cancelled";
      await booking.save();
      return res.status(409).json({
        success: false,
        message: "The property was booked by another guest during payment. Please contact support for an immediate refund.",
      });
    }

    // 6. Mark booking as paid and confirmed
    booking.paid = true;
    booking.paymentStatus = "paid";
    booking.razorpayPaymentId = razorpay_payment_id;
    booking.razorpaySignature = razorpay_signature;
    await booking.save();

    res.status(200).json({
      success: true,
      message: "Payment successful and booking confirmed!",
      booking,
    });
  } catch (error) {
    console.error("verifyPayment error:", error);
    res.status(500).json({
      success: false,
      message: "Payment verification error occurred",
    });
  }
};

// 3. RAZORPAY WEBHOOK - Idempotent, signature-verified webhook handler
const razorpayWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const rawBody = req.rawBody;

    if (!signature || !rawBody) {
      return res.status(400).json({ status: "fail", message: "Missing webhook signature or payload" });
    }

    const isValid = verifyWebhookSignature({ rawBody, signature });
    if (!isValid) {
      console.warn("Unauthorized webhook attempt rejected");
      return res.status(400).json({ status: "fail", message: "Invalid webhook signature" });
    }

    const event = JSON.parse(rawBody.toString("utf8"));
    const eventType = event.event;

    if (eventType === "order.paid" || eventType === "payment.captured") {
      const paymentEntity = event.payload?.payment?.entity || event.payload?.order?.entity;
      const orderId = paymentEntity?.order_id || paymentEntity?.id;

      if (orderId) {
        const booking = await Booking.findOne({ razorpayOrderId: orderId });
        if (booking && !booking.paid) {
          booking.paid = true;
          booking.paymentStatus = "paid";
          if (paymentEntity?.id && paymentEntity.id.startsWith("pay_")) {
            booking.razorpayPaymentId = paymentEntity.id;
          }
          await booking.save();

          await Property.findByIdAndUpdate(booking.property, {
            $addToSet: {
              currentBookings: {
                bookingId: booking._id,
                fromDate: booking.fromDate,
                toDate: booking.toDate,
                userId: booking.user,
              },
            },
          });
          console.log(`Webhook successfully processed ${eventType} for order ${orderId}`);
        }
      }
    } else if (eventType === "payment.failed") {
      const paymentEntity = event.payload?.payment?.entity;
      const orderId = paymentEntity?.order_id;
      if (orderId) {
        await Booking.findOneAndUpdate(
          { razorpayOrderId: orderId, paid: false },
          { paymentStatus: "failed" }
        );
      }
    }

    res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.status(500).json({ status: "error", message: "Internal server error" });
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
      return res.status(404).json({
        status: "fail",
        message: "Booking not found",
      });
    }

    res.status(200).json({
      status: "success",
      data: {
        bookings: booking,
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
};
