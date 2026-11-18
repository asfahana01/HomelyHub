import rateLimit from "express-rate-limit";

// Rate limiter for authentication endpoints
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Limit each IP to 15 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "fail",
    message: "Too many authentication attempts from this IP, please try again after 15 minutes.",
  },
});

// Rate limiter for AI generation endpoints
export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "fail",
    message: "Too many AI generation requests from this IP, please try again later.",
  },
});

// Rate limiter for payment order creation and verification
export const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "fail",
    message: "Too many payment requests from this IP, please try again later.",
  },
});

// General API rate limiter
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "fail",
    message: "Too many requests from this IP, please try again later.",
  },
});

// Recursively sanitize objects to prevent NoSQL operator injection
const hasMongoOperator = (obj) => {
  if (!obj || typeof obj !== "object") return false;

  for (const key of Object.keys(obj)) {
    if (key.startsWith("$") || key.includes(".")) {
      return true;
    }
    if (typeof obj[key] === "object" && hasMongoOperator(obj[key])) {
      return true;
    }
  }
  return false;
};

export const sanitizeNoSql = (req, res, next) => {
  if (
    hasMongoOperator(req.body) ||
    hasMongoOperator(req.query) ||
    hasMongoOperator(req.params)
  ) {
    return res.status(400).json({
      status: "fail",
      message: "Prohibited query characters detected.",
    });
  }
  next();
};
