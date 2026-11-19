import mongoose from "mongoose";

const webhookEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
    },
    eventType: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "processed", "failed"],
      default: "pending",
    },
    leaseExpiresAt: {
      type: Date,
    },
    claimToken: {
      type: String,
    },
    processingStartedAt: {
      type: Date,
    },
    lastError: {
      type: String,
    },
    processedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

webhookEventSchema.index({ status: 1, leaseExpiresAt: 1 });

const WebhookEvent =
  mongoose.models.WebhookEvent ||
  mongoose.model("WebhookEvent", webhookEventSchema);

export { WebhookEvent };