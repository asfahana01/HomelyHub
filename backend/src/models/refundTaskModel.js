import mongoose from "mongoose";

const refundTaskSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    orderId: {
      type: String,
      required: true,
    },
    paymentId: {
      type: String,
      required: true,
      unique: true,
    },
    reason: {
      type: String,
      enum: ["booking_unavailable", "customer_cancellation"],
      default: "booking_unavailable",
    },
    refundId: {
      type: String,
    },
    refundIdempotencyKey: {
      type: String,
    },
    amount: {
      type: Number,
      required: true,
      min: [1, "Refund amount must be positive"],
    },
    currency: {
      type: String,
      required: true,
      enum: ["INR"],
      default: "INR",
    },
    status: {
      type: String,
      enum: ["pending", "processing", "processed", "failed"],
      default: "pending",
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    nextRetryAt: {
      type: Date,
      default: Date.now,
    },
    leaseExpiresAt: {
      type: Date,
    },
    claimToken: {
      type: String,
    },
    lastError: {
      type: String,
    },
  },
  { timestamps: true }
);

refundTaskSchema.index({ status: 1, nextRetryAt: 1 });

const RefundTask =
  mongoose.models.RefundTask ||
  mongoose.model("RefundTask", refundTaskSchema);

export { RefundTask };
