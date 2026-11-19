import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { AuthSession, RefreshToken } from "../models/authSessionModel.js";

const USER_API_PATH = "/api/v1/rent/user";

const durationToMs = (value) => {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    throw new Error("JWT_ACCESS_EXPIRES_IN must be a duration such as 15m");
  }
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const duration = Number(match[1]) * unitMs[match[2]];
  if (duration < 1000 || duration > 60 * 60 * 1000) {
    throw new Error("JWT access-token lifetime must be between 1 second and 1 hour");
  }
  return duration;
};

const refreshExpiry = () => {
  const days = Number(process.env.JWT_REFRESH_EXPIRES_DAYS || 30);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error("JWT_REFRESH_EXPIRES_DAYS must be between 1 and 90");
  }
  return new Date(Date.now() + days * 86_400_000);
};

const hashRefreshToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const signinToken = (id, sessionId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured in environment variables");
  }
  return jwt.sign({ id, sid: sessionId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    jwtid: crypto.randomUUID(),
  });
};

const cookieOptions = (expires) => ({
  expires,
  httpOnly: true,
  sameSite: "strict",
  secure: process.env.NODE_ENV === "production",
  path: USER_API_PATH,
});

const setAuthCookies = (res, accessToken, refreshToken, refreshExpiresAt) => {
  const accessExpiry = new Date(
    Date.now() + durationToMs(process.env.JWT_ACCESS_EXPIRES_IN || "15m")
  );
  res.cookie("jwt", accessToken, {
    ...cookieOptions(accessExpiry),
    signed: true,
  });
  res.cookie("refreshToken", refreshToken, {
    ...cookieOptions(refreshExpiresAt),
    signed: true,
  });
};

const createSendToken = async (user, statusCode, res) => {
  const sessionId = crypto.randomUUID();
  const refreshToken = crypto.randomBytes(32).toString("base64url");
  const expiresAt = refreshExpiry();
  await AuthSession.create({
    sessionId,
    user: user._id,
    expiresAt,
  });
  await RefreshToken.create({
    sessionId,
    user: user._id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt,
  });

  setAuthCookies(res, signinToken(user._id, sessionId), refreshToken, expiresAt);
  const safeUser = user.toObject ? user.toObject() : { ...user };
  delete safeUser.password;
  delete safeUser.passwordConfirm;
  delete safeUser.passwordResetToken;
  delete safeUser.passwordResetExpires;

  res.status(statusCode).json({
    status: "Success",
    user: safeUser,
  });
};

const defaultAvatarUrl = (name) =>
  "https://ui-avatars.com/api/?name=" +
  encodeURIComponent(name || "User") +
  "&background=0e8b53&color=fff&size=256&bold=true";

const filterObj = (obj, ...allowedFields) => {
  const filtered = {};
  Object.keys(obj).forEach((key) => {
    if (allowedFields.includes(key)) filtered[key] = obj[key];
  });
  return filtered;
};

export {
  AuthSession,
  RefreshToken,
  createSendToken,
  defaultAvatarUrl,
  filterObj,
  hashRefreshToken,
  refreshExpiry,
  setAuthCookies,
  signinToken,
};
