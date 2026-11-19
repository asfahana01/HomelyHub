import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema(
  {
    property: {
      type: mongoose.Schema.ObjectId,
      ref: "Property",
      required: [true, "Booking must belong to a property"],
    },
    user: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "Booking must belong to a user"],
    },
    price: {
      type: Number,
      required: [true, "Booking must have a price"],
      min: [1, "Booking price must be a positive number"],
    },
    paid: {
      type: Boolean,
      default: false, // SAFE DEFAULT: payments start unpaid until cryptographically verified
    },
    paymentStatus: {
      type: String,
      enum: [
        "pending",
        "authorized",
        "confirming",
        "paid",
        "failed",
        "cancelled",
        "refund_pending",
        "refund_processed",
      ],
      default: "pending",
    },
    cancellationStatus: {
      type: String,
      enum: ["none", "refund_pending", "cancelled"],
      default: "none",
    },
    cancellationRequestedAt: {
      type: Date,
    },
    cancelledAt: {
      type: Date,
    },
    confirmingPaymentId: {
      type: String,
    },
    razorpayOrderId: {
      type: String,
    },
    razorpayPaymentId: {
      type: String,
    },
    razorpaySignature: {
      type: String,
    },
    holdExpiresAt: {
      type: Date,
    },
    fromDate: {
      type: Date,
      required: [true, "Booking must have a check-in date"],
    },
    toDate: {
      type: Date,
      required: [true, "Booking must have a check-out date"],
    },
    guests: {
      type: Number,
      required: [true, "Booking must have guest count"],
      min: [1, "At least 1 guest is required"],
    },
    numberOfnights: {
      type: Number,
      required: [true, "Booking must have number of nights"],
      min: [1, "At least 1 night is required"],
    },
  },
  { timestamps: true }
);

// Indexes for performance and lookup integrity
bookingSchema.index({ user: 1, createdAt: -1 });
bookingSchema.index({ property: 1, fromDate: 1, toDate: 1 });
bookingSchema.index({ razorpayOrderId: 1 });

// Query middleware - only populate necessary public fields
bookingSchema.pre(/^find/, function () {
  this.populate({
    path: "user",
    select: "name avatar email phoneNumber",
  });
  this.populate({
    path: "property",
    select: "maximumGuest images propertyName address price",
  });
});

const Booking = mongoose.models.Booking || mongoose.model("Booking", bookingSchema);

export { Booking };
