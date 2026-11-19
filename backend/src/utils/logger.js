import crypto from "node:crypto";

const writeLog = (level, event, fields = {}) => {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const output = JSON.stringify(record);
  if (level === "error" || level === "warn") {
    console.error(output);
  } else {
    console.log(output);
  }
};

export const logger = {
  info: (event, fields) => writeLog("info", event, fields),
  warn: (event, fields) => writeLog("warn", event, fields),
  error: (event, fields) => writeLog("error", event, fields),
};

export const requestIdMiddleware = (req, res, next) => {
  const suppliedId = req.get("x-request-id");
  req.requestId =
    typeof suppliedId === "string" && /^[A-Za-z0-9-]{1,64}$/.test(suppliedId)
      ? suppliedId
      : crypto.randomUUID();
  res.setHeader("x-request-id", req.requestId);
  const startedAt = Date.now();
  res.on("finish", () => {
    logger.info("http.request", {
      requestId: req.requestId,
      method: req.method,
      route: req.route?.path || "unmatched",
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });
  next();
};

