import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import connectDB from "./utils/db.js";
import { router } from "./routes/userRoutes.js";
import { propertyRouter } from "./routes/propertyRouter.js";
import { bookingRouter } from "./routes/bookingRouter.js";
import { tripRouter } from "./routes/tripRouter.js";
import { generalLimiter, sanitizeNoSql } from "./utils/security.js";

dotenv.config();

const app = express();

// 1. HTTP Security Headers
app.use(
  helmet({
    contentSecurityPolicy: false, // Disables strict CSP to allow Razorpay Checkout script and CDN assets
    crossOriginEmbedderPolicy: false,
  })
);

// 2. Strict CORS Configuration
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.ORIGIN_ACCESS_URL,
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        process.env.NODE_ENV !== "production"
      ) {
        return callback(null, true);
      }
      return callback(
        new Error(`CORS policy error: Origin ${origin} is not allowed`),
        false
      );
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "x-razorpay-signature",
    ],
  })
);

// 3. Body parsers with safe size limits and rawBody capture for webhook verification
app.use(
  express.json({
    limit: "10mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(express.urlencoded({ limit: "1mb", extended: true }));

// 4. Cookie parser
app.use(cookieParser());

// 5. NoSQL Injection protection
app.use(sanitizeNoSql);

// 6. General API Rate Limiting
app.use("/api", generalLimiter);

const PORT = process.env.PORT || 3000;

// Health check endpoint
app.get("/", (req, res) => {
  res.status(200).send("HomelyHub Backend server is running securely");
});

// API Routes
app.use("/api/v1/rent/user", router);
app.use("/api/v1/rent/listing", propertyRouter);
app.use("/api/v1/rent/user/booking", bookingRouter);
app.use("/api/v1/rent/trip", tripRouter);

// 404 Route Handler
app.all("/{*splat}", (req, res) => {
  res.status(404).json({
    status: "fail",
    message: `Can't find ${req.originalUrl} on this server`,
  });
});

// Centralized Error Handling Middleware (No stack trace or db leak in production)
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const status = err.status || (statusCode >= 500 ? "error" : "fail");

  if (process.env.NODE_ENV !== "production") {
    console.error("Centralized Error:", err);
  }

  const message =
    process.env.NODE_ENV === "production" && statusCode === 500
      ? "An unexpected error occurred. Please try again later."
      : err.message || "Internal Server Error";

  res.status(statusCode).json({
    status,
    message,
  });
});

// Connect to Database
connectDB();

if (process.env.NODE_ENV !== "test") {
  const refundInterval =
    Number(process.env.REFUND_WORKER_INTERVAL_MS) || 60 * 1000;
  import("./services/refundWorker.js")
    .then(({ startRefundWorker }) => startRefundWorker({ intervalMs: refundInterval }))
    .catch((error) => {
      console.error(
        "Unable to start refund reconciliation worker:",
        error instanceof Error ? error.message : "Unknown error"
      );
    });

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

export default app;
