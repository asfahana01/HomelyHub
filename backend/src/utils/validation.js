import { z } from "zod";
import { logger } from "./logger.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Must be a valid ObjectId");
const boundedString = (min, max) => z.string().trim().min(min).max(max);
const numericInput = z.union([
  z.number().finite(),
  z.string().trim().regex(/^\d+(\.\d+)?$/),
]).transform(Number);

const amenitySchema = z.object({
  name: z.enum([
    "wifi",
    "Kitchen",
    "Ac",
    "Washing Machine",
    "Tv",
    "Pool",
    "Free Parking",
  ]),
  icon: boundedString(1, 80),
}).strict();

const imageSchema = z.object({
  public_id: z.string().max(200).optional(),
  url: z.string().min(1).max(7_000_000).refine(
    (value) =>
      /^https?:\/\//i.test(value) ||
      /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(value),
    "Must be an HTTP(S) URL or supported image data URL"
  ),
}).strict();
const avatarSchema = z.string().max(7_000_000).refine(
  (value) =>
    value === "" ||
    /^https?:\/\//i.test(value) ||
    /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(value),
  "Must be an HTTP(S) URL or supported image data URL"
);
const optionalAiNumber = (schema) =>
  z.preprocess(
    (value) => (value === "" || value === 0 || value === "0" ? undefined : value),
    schema.optional()
  );
const optionalAiAddressSchema = z.object({
  area: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  pincode: z.union([
    z.number().int().min(1000).max(9999999),
    z.string().regex(/^\d{0,7}$/),
  ]).optional(),
}).strict();

const addressSchema = z.object({
  area: boundedString(1, 100),
  city: boundedString(1, 100),
  state: boundedString(1, 100),
  pincode: z.union([
    z.number().int().min(1000).max(9999999),
    z.string().regex(/^\d{4,7}$/),
  ]),
}).strict();

const propertyFields = {
  propertyName: boundedString(2, 150),
  description: boundedString(20, 5000),
  propertyType: z.enum(["House", "Flat", "Guest House", "Hotel", "villa", "Resort"]),
  roomType: z.enum(["Anytype", "Room", "Entire Home"]),
  extraInfo: z.string().trim().max(1000).optional(),
  address: addressSchema,
  amenities: z.array(amenitySchema).max(20),
  checkInTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  checkOutTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  isActive: z.boolean(),
  maximumGuest: numericInput.pipe(z.number().int().min(1).max(100)),
  price: numericInput.pipe(z.number().min(1).max(1_000_000)),
  images: z.array(imageSchema).min(6).max(15),
};

export const requestSchemas = {
  emptyBody: z.object({}).strict().optional().default({}),
  emptyQuery: z.object({}).strict().optional().default({}),
  signup: z.object({
    name: boundedString(2, 20),
    email: z.string().trim().email().max(254).toLowerCase(),
    phoneNumber: z.string().trim().regex(/^[+\d\s()-]{7,20}$/),
    password: z.string().min(6).max(128),
    passwordConfirm: z.string().min(6).max(128),
    avatar: avatarSchema.optional(),
  }).strict().refine((value) => value.password === value.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "Passwords do not match",
  }),
  login: z.object({
    email: z.string().trim().email().max(254).toLowerCase(),
    password: z.string().min(1).max(128),
  }).strict(),
  profile: z.object({
    name: boundedString(2, 20).optional(),
    phoneNumber: z.string().trim().regex(/^[+\d\s()-]{7,20}$/).optional(),
    avatar: avatarSchema.optional(),
  }).strict().refine((value) => Object.keys(value).length > 0),
  updatePassword: z.object({
    passwordCurrent: z.string().min(1).max(128),
    password: z.string().min(6).max(128),
    passwordConfirm: z.string().min(6).max(128),
  }).strict().refine((value) => value.password === value.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "Passwords do not match",
  }),
  forgotPassword: z.object({
    email: z.string().trim().email().max(254).toLowerCase(),
  }).strict(),
  resetPassword: z.object({
    password: z.string().min(6).max(128),
    passwordConfirm: z.string().min(6).max(128),
  }).strict().refine((value) => value.password === value.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "Passwords do not match",
  }),
  tokenParam: z.object({
    token: z.string().regex(/^[a-f\d]{64}$/i),
  }).strict(),
  propertyIdParam: z.object({
    id: objectId,
  }).strict(),
  bookingIdParam: z.object({
    bookingId: objectId,
  }).strict(),
  createProperty: z.object(propertyFields).omit({ isActive: true }).strict(),
  updateProperty: z.object(propertyFields).partial().strict()
    .refine((value) => Object.keys(value).length > 0),
  createOrder: z.object({
    propertyId: objectId,
    fromDate: z.string().date(),
    toDate: z.string().date(),
    guests: z.number().int().min(1).max(100),
  }).strict(),
  verifyPayment: z.object({
    razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9_]+$/).max(64),
    razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9_]+$/).max(64),
    razorpay_signature: z.string().regex(/^[a-f\d]{64}$/i),
  }).strict(),
  tripPlan: z.object({
    destination: boundedString(2, 100),
    budget: numericInput.pipe(z.number().positive().max(10_000_000)),
    days: numericInput.pipe(z.number().int().min(1).max(30)),
    people: numericInput.pipe(z.number().int().min(1).max(30)),
    interests: z.array(z.enum([
      "Beach",
      "Food",
      "Nightlife",
      "Nature",
      "Adventure",
      "Shopping",
      "History",
      "Relaxation",
    ])).max(10).optional().default([]),
  }).strict(),
  propertyDescription: z.object({
    propertyName: boundedString(2, 150),
    extraInfo: z.string().trim().max(1000).optional(),
    propertyType: propertyFields.propertyType.optional(),
    roomType: propertyFields.roomType.optional(),
    maximumGuest: optionalAiNumber(numericInput.pipe(z.number().int().min(1).max(100))),
    amenities: z.array(amenitySchema).max(20).optional(),
    price: optionalAiNumber(numericInput.pipe(z.number().min(1).max(1_000_000))),
    address: optionalAiAddressSchema.optional(),
  }).strict(),
  adminUserList: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }).strict(),
  updateUserRole: z.object({
    role: z.enum(["user", "admin"]),
  }).strict(),
  adminUserIdParam: z.object({
    userId: objectId,
  }).strict(),
};

export const validateRequest = (schema, target = "body") => (
  req,
  res,
  next
) => {
  const parsed = schema.safeParse(req[target]);
  if (!parsed.success) {
    if (
      req.originalUrl?.includes("generateDescription") ||
      req.originalUrl?.includes("createTripPlan") ||
      req.baseUrl?.includes("/rent/trip")
    ) {
      logger.warn("security.ai.input_rejected", {
        requestId: req.requestId,
      });
    }
    return res.status(400).json({
      status: "fail",
      message: "Invalid request data",
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  req.validated ??= {};
  req.validated[target] = parsed.data;
  if (target !== "query") req[target] = parsed.data;
  next();
};

export const parseAiTripOutput = (value, expectedDays) => {
  const schema = z.object({
    summary: boundedString(10, 500),
    days: z.array(z.object({
      day: z.number().int().min(1),
      title: boundedString(1, 100),
      activities: z.array(
        boundedString(5, 500).refine(
          (activity) => /^(Morning|Afternoon|Evening):\s/i.test(activity),
          "Activity must include a time of day"
        )
      ).min(3).max(4),
    }).strict()).length(expectedDays),
    tips: z.array(boundedString(3, 300)).min(1).max(10),
  }).strict().refine(
    (plan) => plan.days.every((day, index) => day.day === index + 1),
    "Day numbers must be sequential"
  );
  return schema.parse(value);
};

export const parseRazorpayWebhookEvent = (value) => {
  const paymentId = z.string().regex(/^pay_[A-Za-z0-9_]+$/).max(64);
  const orderId = z.string().regex(/^order_[A-Za-z0-9_]+$/).max(64);
  const eventSchema = z.object({
    event: z.string().min(1).max(100),
  }).passthrough();
  const event = eventSchema.parse(value);

  if (event.event === "payment.captured") {
    return z.object({
      event: z.literal("payment.captured"),
      payload: z.object({
        payment: z.object({
          entity: z.object({
            id: paymentId,
            order_id: orderId,
            amount: z.number().int().positive(),
            currency: z.literal("INR"),
            status: z.literal("captured"),
          }).passthrough(),
        }).passthrough(),
      }).passthrough(),
    }).passthrough().parse(value);
  }

  if (event.event === "payment.failed") {
    return z.object({
      event: z.literal("payment.failed"),
      payload: z.object({
        payment: z.object({
          entity: z.object({
            id: paymentId,
            order_id: orderId,
            status: z.literal("failed"),
          }).passthrough(),
        }).passthrough(),
      }).passthrough(),
    }).passthrough().parse(value);
  }

  return event;
};
