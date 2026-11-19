import crypto from "node:crypto";
import { WebhookEvent } from "../models/webhookEventModel.js";

export const WEBHOOK_PROCESSING_LEASE_MS = 2 * 60 * 1000;

export const claimWebhookEvent = async ({ eventId, eventType }) => {
  const now = new Date();
  const leaseExpiresAt = new Date(Date.now() + WEBHOOK_PROCESSING_LEASE_MS);
  const claimToken = crypto.randomUUID();

  try {
    await WebhookEvent.findOneAndUpdate(
      { eventId },
      {
        $setOnInsert: {
          eventId,
          eventType,
          status: "pending",
        },
      },
      { upsert: true, returnDocument: "after" }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }

  const claimed = await WebhookEvent.findOneAndUpdate(
    {
      eventId,
      $or: [
        { status: { $in: ["pending", "failed"] } },
        {
          status: "processing",
          leaseExpiresAt: { $not: { $gt: now } },
        },
        { status: { $exists: false } },
      ],
    },
    {
      $set: {
        eventType,
        status: "processing",
        leaseExpiresAt,
        claimToken,
        processingStartedAt: now,
        lastError: "",
      },
    },
    { returnDocument: "after" }
  );

  if (claimed) {
    return { claimed: true, event: claimed, claimToken };
  }

  const event = await WebhookEvent.findOne({ eventId });
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
  return { claimed: false, reason: "claim_race", event };
};

export const markWebhookEventProcessed = async (eventId, claimToken) =>
  WebhookEvent.findOneAndUpdate(
    {
      eventId,
      status: "processing",
      claimToken,
      leaseExpiresAt: { $gt: new Date() },
    },
    {
      $set: {
        status: "processed",
        processedAt: new Date(),
        leaseExpiresAt: null,
        claimToken: null,
        lastError: "",
      },
    },
    { returnDocument: "after" }
  );

export const markWebhookEventFailed = async (eventId, claimToken, error) =>
  WebhookEvent.findOneAndUpdate(
    {
      eventId,
      status: "processing",
      claimToken,
      leaseExpiresAt: { $gt: new Date() },
    },
    {
      $set: {
        status: "failed",
        leaseExpiresAt: null,
        claimToken: null,
        lastError:
          error instanceof Error
            ? error.message.slice(0, 2000)
            : String(error).slice(0, 2000),
      },
    },
    { returnDocument: "after" }
  );
