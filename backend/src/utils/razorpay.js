import Razorpay from "razorpay";
import crypto from "node:crypto";

let razorpayInstance = null;

// Create Razorpay instance only when real credentials exist
export const getRazorpayInstance = () => {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    throw new Error("Razorpay API credentials are missing.");
  }

  if (!razorpayInstance) {
    razorpayInstance = new Razorpay({
      key_id,
      key_secret,
    });
  }

  return razorpayInstance;
};

export const createRazorpayRefund = async ({
  paymentId,
  amount,
  notes,
  receipt,
  idempotencyKey,
}) => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("Razorpay API credentials are missing.");
  }
  if (
    !/^pay_[A-Za-z0-9_]+$/.test(paymentId || "") ||
    !Number.isInteger(amount) ||
    amount < 1 ||
    !/^[A-Za-z0-9_-]{10,128}$/.test(idempotencyKey || "")
  ) {
    throw new Error("Refund request parameters are invalid.");
  }

  const response = await fetch(
    `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
        "Content-Type": "application/json",
        "X-Refund-Idempotency": idempotencyKey,
      },
      body: JSON.stringify({ amount, notes, receipt, speed: "normal" }),
    }
  );

  let refund;
  try {
    refund = await response.json();
  } catch {
    throw new Error("Razorpay returned an invalid refund response.");
  }
  if (!response.ok) {
    const error = new Error("Razorpay refund request failed.");
    error.statusCode = response.status;
    throw error;
  }
  return refund;
};

// Verify Razorpay payment callback signature
export const verifyRazorpaySignature = ({
  orderId,
  paymentId,
  signature,
}) => {
  if (!orderId || !paymentId || !signature) return false;

  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;

  const generatedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(generatedSignature, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};

// Verify Razorpay webhook signature
export const verifyWebhookSignature = ({ rawBody, signature }) => {
  if (!rawBody || !signature) return false;

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) return false;

  const generatedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  const expectedBuffer = Buffer.from(generatedSignature, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};
