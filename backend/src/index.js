import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import connectDB from "./utils/db.js";
import { router } from "./routes/userRoutes.js";
import { propertyRouter } from "./routes/propertyRouter.js";
import { bookingRouter } from "./routes/bookingRouter.js";
import { tripRouter } from "./routes/tripRouter.js";
import { generalLimiter, sanitizeNoSql } from "./utils/security.js";
import { startBackend } from "./utils/startup.js";
import { AppError } from "./utils/AppError.js";
import { logger, requestIdMiddleware } from "./utils/logger.js";
import { getEnvironmentIssues } from "./utils/env.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const envIssues =
  process.env.NODE_ENV === "test" ? [] : getEnvironmentIssues();
if (envIssues.length) {
  logger.error("config.validation_failed", { variables: envIssues });
  throw new Error(
    `Missing or invalid required environment variables: ${envIssues.join(", ")}`
  );
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendDist = path.resolve(
  __dirname,
  "../../frontend/dist"
);

const app = express();
app.use(requestIdMiddleware);

// 1. HTTP Security Headers
app.use(
  helmet({
    contentSecurityPolicy: false, // Disables strict CSP to allow Razorpay Checkout script and CDN assets
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
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
app.use(cookieParser(process.env.COOKIE_SECRET || process.env.JWT_SECRET));

// 5. NoSQL Injection protection
app.use(sanitizeNoSql);

// 6. General API Rate Limiting
app.use("/api", generalLimiter);

const PORT = process.env.PORT || 3000;

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/ready", (_req, res) => {
  const checks = {
    database: mongoose.connection.readyState === 1 ? "ready" : "not_ready",
    razorpay:
      process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
        ? "configured"
        : "not_configured",
    ai: process.env.GROQ_API_KEY ? "configured" : "not_configured",
    imageStorage:
      process.env.IMAGE_PUBLICKEY &&
      process.env.IMAGE_PRIVATEKEY &&
      process.env.IMAGEKIT_URLENDPOINT
        ? "configured"
        : "not_configured",
    email:
      process.env.MAILTRAP_SMTP_HOST &&
      process.env.MAILTRAP_SMTP_USER &&
      process.env.MAILTRAP_SMTP_PASS
        ? "configured"
        : "not_configured",
  };
  const ready = Object.values(checks).every(
    (status) => status === "ready" || status === "configured"
  );
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    checks,
  });
});

// API Routes
app.use("/api/v1/rent/user", router);
app.use("/api/v1/rent/listing", propertyRouter);
app.use("/api/v1/rent/user/booking", bookingRouter);
app.use("/api/v1/rent/trip", tripRouter);

// Return JSON for unknown API routes
app.all("/api/{*splat}", (req, res) => {
  res.status(404).json({
    status: "fail",
    message: `Can't find ${req.originalUrl} on this server`,
  });
});

// Serve React production build
app.use(express.static(frontendDist));

// React Router fallback
app.get("/{*splat}", (req, res, next) => {
  res.sendFile(
    path.join(frontendDist, "index.html"),
    (error) => {
      if (error) next(error);
    }
  );
});

// Centralized Error Handling Middleware (No stack trace or db leak in production)
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const status = err.status || (statusCode >= 500 ? "error" : "fail");
  const operational = err instanceof AppError || err.isOperational === true;
  logger.error("http.error", {
    requestId: req.requestId,
    statusCode,
    errorName: err.name || "Error",
  });
  res.status(statusCode).json({
    status,
    message:
      operational && statusCode < 500
        ? err.message
        : "An unexpected error occurred. Please try again later.",
    requestId: req.requestId,
  });
});

if (process.env.NODE_ENV !== "test") {
  const refundInterval =
    Number(process.env.REFUND_WORKER_INTERVAL_MS) || 60 * 1000;
  startBackend({
    connect: connectDB,
    startWorker: async () => {
      const { startRefundWorker } = await import("./services/refundWorker.js");
      await startRefundWorker({ intervalMs: refundInterval });
    },
    listen: () =>
      app.listen(PORT, () => {
        logger.info("backend.server_listening", { port: Number(PORT) });
      }),
  })
    .catch((error) => {
        logger.error("backend.startup_failed", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      process.exitCode = 1;
    });
}

export default app;
