import { WebhookEvent } from "../models/webhookEventModel.js";

export const WEBHOOK_PROCESSING_LEASE_MS = 2 * 60 * 1000;

export const claimWebhookEvent = async ({ eventId, eventType }) => {
  const now = new Date();
  const leaseExpiresAt = new Date(Date.now() + WEBHOOK_PROCESSING_LEASE_MS);

  const claimed = await WebhookEvent.findOneAndUpdate(
    {
      eventId,
      $or: [
        { status: { $in: ["pending", "failed"] } },
        { status: "processing", leaseExpiresAt: { $lte: now } },
        { status: { $exists: false } },
      ],
    },
    {
      $set: {
        eventType,
        status: "processing",
        leaseExpiresAt,
        processingStartedAt: now,
        lastError: "",
      },
    },
    { new: true }
  );

  if (claimed) {
    return { claimed: true, event: claimed };
  }

  let event = await WebhookEvent.findOne({ eventId });
  if (!event) {
    try {
      event = await WebhookEvent.findOneAndUpdate(
        { eventId },
        {
          $setOnInsert: {
            eventId,
            eventType,
            status: "pending",
          },
        },
        { upsert: true, new: true }
      );
    } catch (error) {
      if (error?.code !== 11000) throw error;
      event = await WebhookEvent.findOne({ eventId });
    }

    if (event?.status === "pending" || event?.status === "failed") {
      return claimWebhookEvent({ eventId, eventType });
    }
  }

  if (event?.status === "processed") {
    return { claimed: false, reason: "processed", event };
  }
  if (
    event?.status === "processing" &&
    event.leaseExpiresAt &&
    event.leaseExpiresAt > now
  ) {
    return { claimed: false, reason: "processing", event };
  }
  if (event?.status === "failed") {
    return claimWebhookEvent({ eventId, eventType });
  }

  return claimWebhookEvent({ eventId, eventType });
};

export const markWebhookEventProcessed = async (eventId) =>
  WebhookEvent.findOneAndUpdate(
    { eventId, status: "processing" },
    {
      $set: {
        status: "processed",
        processedAt: new Date(),
        leaseExpiresAt: null,
        lastError: "",
      },
    },
    { new: true }
  );

export const markWebhookEventFailed = async (eventId, error) =>
  WebhookEvent.findOneAndUpdate(
    { eventId, status: "processing" },
    {
      $set: {
        status: "failed",
        leaseExpiresAt: null,
        lastError:
          error instanceof Error
            ? error.message.slice(0, 2000)
            : String(error).slice(0, 2000),
      },
    },
    { new: true }
  );
