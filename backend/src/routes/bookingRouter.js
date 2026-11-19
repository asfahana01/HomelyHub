import express from "express";
import {
  getBookingDetails,
  getUserBookings,
  createOrder,
  verifyPayment,
  razorpayWebhook,
  cancelBooking,
} from "../controllers/bookingController.js";
import { protect } from "../controllers/authController.js";
import { paymentLimiter } from "../utils/security.js";
import { requestSchemas, validateRequest } from "../utils/validation.js";

const bookingRouter = express.Router();

// Webhook endpoint (publicly reachable by Razorpay, signature-verified)
bookingRouter.post("/webhook", razorpayWebhook);

// Protected booking endpoints
bookingRouter.get("/", protect, getUserBookings);
bookingRouter.get(
  "/:bookingId",
  protect,
  validateRequest(requestSchemas.bookingIdParam, "params"),
  getBookingDetails
);
bookingRouter.post(
  "/:bookingId/cancel",
  protect,
  paymentLimiter,
  validateRequest(requestSchemas.bookingIdParam, "params"),
  validateRequest(requestSchemas.emptyBody),
  cancelBooking
);
bookingRouter.post(
  "/create-order",
  protect,
  paymentLimiter,
  validateRequest(requestSchemas.createOrder),
  createOrder
);
bookingRouter.post(
  "/verify-payment",
  protect,
  paymentLimiter,
  validateRequest(requestSchemas.verifyPayment),
  verifyPayment
);

export { bookingRouter };
