//  authController.js  -  the security guard of our app

//    signup / login / logout        - getting in and out
//    protect                        - the guard at the gate
//    updateMe / updatePassword      - changing my own details
//    forgotPassword / resetPassword - I lost my password
//    check                          - who is logged in?

import { User } from "../models/userModel.js";
import { AuthSession, RefreshToken } from "../models/authSessionModel.js";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import imagekit from "../utils/ImagekitIO.js";
import { forgotPasswordMailGenContent, sendMail } from "../utils/mail.js";
import { logger } from "../utils/logger.js";
import {
  hashRefreshToken,
  refreshExpiry,
  setAuthCookies,
  signinToken,
  createSendToken,
  defaultAvatarUrl,
  filterObj,
} from "../utils/token.js";

// 1. SIGNUP - make new account

const signup = async (req, res) => {
  try {
    const newUser = await User.create({
      name: req.body.name,
      email: req.body.email,
      phoneNumber: req.body.phoneNumber,
      password: req.body.password,
      passwordConfirm: req.body.passwordConfirm,
      avatar: { url: req.body.avatar || defaultAvatarUrl(req.body.name) },
      role: "user", // strictly enforce role to normal user
    });
    await createSendToken(newUser, 201, res);
  } catch (error) {
    const duplicatedField = Object.keys(error.keyPattern || {})[0];
    logger.warn("security.auth.signup_failed", {
      requestId: req.requestId,
      errorName: error.name || "Error",
    });
    const message = duplicatedField
      ? `An account with that ${duplicatedField} already exists`
      : "Could not create account. Please try again.";

    res.status(400).json({ status: "fail", message });
  }
};

// 2. LOGIN - check email + password, then give a token

const login = async (req, res) => {
  try {
    // Take out the two fields we need from the body
    const { email, password } = req.body;
    // Nothing typed? Stop here, no point asking the database.
    if (!email || !password) {
      throw new Error("Please Provide email and password");
    }
    // Find that user. Normally the password never comes out
    // (select:false in the model). The +password says 'this
    // one time, bring it too' - we need it to compare.
    const user = await User.findOne({ email }).select("+password");

    // Two checks in one if:
    //   no such user   OR   the password does not match
    // Both give the SAME message on purpose. If we said 'no
    // such email', anyone could find out which emails are
    // registered on our site.
    if (
      !user ||
      (await user.correctPassword(password, user.password)) === false
    ) {
      throw new Error("Incorrect email or password");
    }
    // Correct. 200 = ok. Token goes back in a cookie.
    await createSendToken(user, 200, res);
  } catch (error) {
    const invalidCredentials = error.message === "Incorrect email or password";
    logger.warn("security.auth.login_failed", {
      requestId: req.requestId,
      errorName: error.name || "Error",
    });
    res.status(invalidCredentials ? 401 : 500).json({
      status: invalidCredentials ? "fail" : "error",
      message: invalidCredentials
        ? "Incorrect email or password"
        : "An unexpected error occurred. Please try again later.",
    });
  }
};

// 3. LOGOUT - throw the cookie away

// A token cannot be cancelled, and we cannot reach into the
// user's browser. So we send a NEW cookie with the same name
// that is already expired. The browser deletes it at once.
const revokeSession = async (sessionId) => {
  if (!sessionId) return;
  const revokedAt = new Date();
  await Promise.all([
    AuthSession.updateOne(
      { sessionId, revokedAt: null },
      { $set: { revokedAt } }
    ),
    RefreshToken.updateMany(
      { sessionId, revokedAt: null },
      { $set: { revokedAt } }
    ),
  ]);
};

const clearAuthCookies = (res) => {
  const paths = ["/api/v1/rent", "/api/v1/rent/user"];

  for (const path of paths) {
    const options = {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path,
    };

    res.clearCookie("jwt", options);
    res.clearCookie("refreshToken", options);
  }
};
const logout = async (req, res, next) => {
  try {
    let sessionId;
    const refreshToken = req.signedCookies?.refreshToken;
    if (typeof refreshToken === "string") {
      const storedToken = await RefreshToken.findOne({
        tokenHash: hashRefreshToken(refreshToken),
      }).select("sessionId");
      sessionId = storedToken?.sessionId;
    }

    const accessToken =
      typeof req.signedCookies?.jwt === "string"
        ? req.signedCookies.jwt
        : req.headers.authorization?.startsWith("Bearer ")
          ? req.headers.authorization.split(" ")[1]
          : undefined;
    if (!sessionId && accessToken) {
      try {
        const decoded = jwt.verify(
          accessToken,
          process.env.JWT_SECRET,
          { ignoreExpiration: true }
        );
        sessionId = decoded.sid;
      } catch {
        sessionId = undefined;
      }
    }

    await revokeSession(sessionId);
    clearAuthCookies(res);
    res.status(200).json({
      status: "success",
      message: "Logged out successfully",
    });
  } catch (error) {
    next(error);
  }
};

// 4. PROTECT - authentication verification middleware

const protect = async (req, res, next) => {
  try {
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    } else if (typeof req.signedCookies?.jwt === "string") {
      token = req.signedCookies.jwt;
    }

    if (!token) {
      return res.status(401).json({
        status: "fail",
        message: "You are not logged in! Please log in to get access.",
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        status: "error",
        message: "JWT secret is not configured on the server",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === "TokenExpiredError") {
        return res.status(401).json({
          status: "fail",
          message: "Your session has expired! Please log in again.",
        });
      }
      return res.status(401).json({
        status: "fail",
        message: "Invalid authentication token. Please log in again.",
      });
    }

    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
      return res.status(401).json({
        status: "fail",
        message: "The user belonging to this token no longer exists.",
      });
    }

    if (currentUser.changedPasswordAfter(decoded.iat)) {
      return res.status(401).json({
        status: "fail",
        message: "User recently changed password! Please log in again.",
      });
    }

    if (!decoded.sid) {
      return res.status(401).json({
        status: "fail",
        message: "Your session is no longer valid. Please log in again.",
      });
    }
    const session = await AuthSession.findOne({
      sessionId: decoded.sid,
      user: currentUser._id,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).select("_id");
    if (!session) {
      return res.status(401).json({
        status: "fail",
        message: "Your session is no longer valid. Please log in again.",
      });
    }

    req.user = currentUser;
    next();
  } catch (error) {
    next(error);
  }
};

const refreshAccessToken = async (req, res, next) => {
  try {
    const rawToken = req.signedCookies?.refreshToken;
    if (typeof rawToken !== "string") {
      clearAuthCookies(res);
      return res.status(401).json({
        status: "fail",
        message: "Refresh token is invalid or expired",
      });
    }

    const storedToken = await RefreshToken.findOne({
      tokenHash: hashRefreshToken(rawToken),
    });
    if (!storedToken) {
      clearAuthCookies(res);
      return res.status(401).json({
        status: "fail",
        message: "Refresh token is invalid or expired",
      });
    }

    if (storedToken.consumedAt || storedToken.revokedAt) {
      if (storedToken.consumedAt) await revokeSession(storedToken.sessionId);
      clearAuthCookies(res);
      return res.status(401).json({
        status: "fail",
        message: "Refresh token is invalid or expired",
      });
    }

    const now = new Date();
    const session = await AuthSession.findOne({
      sessionId: storedToken.sessionId,
      user: storedToken.user,
      revokedAt: null,
      expiresAt: { $gt: now },
    });
    const user = session ? await User.findById(storedToken.user) : null;
    if (!session || !user) {
      await revokeSession(storedToken.sessionId);
      clearAuthCookies(res);
      return res.status(401).json({
        status: "fail",
        message: "Refresh token is invalid or expired",
      });
    }
    if (
      user.passwordChangedAt &&
      user.passwordChangedAt.getTime() > session.createdAt.getTime()
    ) {
      await revokeSession(storedToken.sessionId);
      clearAuthCookies(res);
      return res.status(401).json({
        status: "fail",
        message: "Your session is no longer valid. Please log in again.",
      });
    }

    const nextRawToken = crypto.randomBytes(32).toString("base64url");
    const nextTokenHash = hashRefreshToken(nextRawToken);
    const nextExpiresAt = refreshExpiry();
    const consumed = await RefreshToken.findOneAndUpdate(
      {
        _id: storedToken._id,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { $gt: now },
      },
      { $set: { consumedAt: now, replacedByHash: nextTokenHash } },
      { new: true }
    );
    if (!consumed) {
      await revokeSession(storedToken.sessionId);
      clearAuthCookies(res);
      return res.status(401).json({
        status: "fail",
        message: "Refresh token is invalid or expired",
      });
    }

    try {
      await RefreshToken.create({
        sessionId: storedToken.sessionId,
        user: storedToken.user,
        tokenHash: nextTokenHash,
        expiresAt: nextExpiresAt,
      });
      session.expiresAt = nextExpiresAt;
      await session.save();
    } catch (error) {
      await revokeSession(storedToken.sessionId);
      throw error;
    }

    setAuthCookies(
      res,
      signinToken(user._id, storedToken.sessionId),
      nextRawToken,
      nextExpiresAt
    );
    return res.status(200).json({ status: "Success", user });
  } catch (error) {
    next(error);
  }
};

// 4.1 RESTRICT TO - role-based authorization guard
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        status: "fail",
        message: "You do not have permission to perform this action",
      });
    }
    next();
  };
};

// 5. UPDATE ME - change my name, phone or photo

const updateMe = async (req, res) => {
  try {
    const filteredBody = filterObj(req.body, "name", "phoneNumber", "avatar");

    const sentPhoto =
      req.body.avatar !== undefined && String(req.body.avatar).trim() !== "";

    const currentAvatarUrl = (req.user.avatar && req.user.avatar.url) || "";
    const usingInitials = currentAvatarUrl.includes("ui-avatars.com");

    if (sentPhoto) {
      const avatarStr = String(req.body.avatar);
      const isHttpUrl = /^https?:\/\//i.test(avatarStr);
      const isBase64Image = /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(avatarStr);

      if (!isHttpUrl && !isBase64Image) {
        return res.status(400).json({
          status: "fail",
          message: "Invalid image format. Allowed formats: JPEG, PNG, WEBP, or valid URL.",
        });
      }

      if (isBase64Image && avatarStr.length > 5 * 1024 * 1024 * 1.37) {
        return res.status(400).json({
          status: "fail",
          message: "Avatar image exceeds maximum allowed size of 5MB.",
        });
      }

      const uploadResponse = await imagekit.upload({
        file: req.body.avatar,
        fileName: `avatar_${Date.now()}.jpg`,
        folder: "avatars",
      });
      filteredBody.avatar = {
        public_id: uploadResponse.fileId,
        url: uploadResponse.url,
      };
    } else if (
      req.body.avatar !== undefined ||
      (filteredBody.name && usingInitials)
    ) {
      filteredBody.avatar = {
        url: defaultAvatarUrl(filteredBody.name || req.user.name),
      };
    } else {
      delete filteredBody.avatar;
    }
    const updateUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      status: "Success",
      data: {
        user: updateUser,
      },
    });
  } catch (error) {
    res.status(400).json({
      status: "Fail",
      message: "Could not update profile. Please try again.",
    });
  }
};

// 6. UPDATE PASSWORD - I know my old password, change it

const updatePassword = async (req, res) => {
  try {
    // +password again, because we must compare the old one.
    const user = await User.findById(req.user.id).select("+password");

    // He is already logged in, so why ask the old password?
    // Because he may have left the laptop open and anyone
    // passing by could take over the account.
    if (
      !(await user.correctPassword(req.body.passwordCurrent, user.password))
    ) {
      const authError = new Error("Your current password is wrong");
      authError.statusCode = 401;
      throw authError;
    }

    // Set the new password on the user object...
    user.password = req.body.password;
    user.passwordConfirm = req.body.passwordConfirm;
    // ...then save(). This is important: save() runs the
    // pre-save hook, so the new password gets hashed.
    // findByIdAndUpdate would NOT run it and the password
    // would be stored as plain text. For passwords: save().
    await user.save();

    // A fresh token, because the old one now counts as 'made
    // before the password change' and would be rejected.
    await AuthSession.updateMany(
      { user: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    await RefreshToken.updateMany(
      { user: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    await createSendToken(user, 200, res);
  } catch (error) {
    res.status(error.statusCode || 400).json({
      status: "fail",
      message:
        error.statusCode === 401
          ? error.message
          : "Could not update password. Please try again.",
    });
  }
};

// 7. FORGOT PASSWORD - mail me a reset link

const forgotPassword = async (req, res) => {
  // The SAME reply whether the email exists or not. If we said
  // 'no such email', a stranger could test thousands of emails
  // and find out who is registered here.
  const genericResponse = {
    status: "success",
    message: "If that email is registered, a reset link has been sent",
  };

  try {
    const user = await User.findOne({ email: req.body.email });

    // No such user - reply normally and quietly stop.
    if (!user) return res.status(200).json(genericResponse);

    // From userModel.js. It gives back the plain token
    // for the email, and stores only its HASH in the database.
    // So a stolen database cannot reset anybody's password.
    const resetToken = user.createPasswordResetToken();
    // Skip the model checks this once - we are only adding a
    // token, and it would ask for passwordConfirm again.
    await user.save({ validateBeforeSave: false });

    // The link the user will click. It points at the FRONTEND
    // address, with the plain token at the end.
    const resetURL = `${process.env.ORIGIN_ACCESS_URL}/user/resetPassword/${resetToken}`;

    // A second try inside the first one, only for the email.
    try {
      await sendMail({
        email: user.email,
        subject: "Reset your Password (valid for 10 mins)",
        mailGenContent: forgotPasswordMailGenContent(user.name, resetURL),
      });
      // Mail failed. The user has no link, but a reset token is
      // now sitting in the database doing nothing. Clean it up.
    } catch (mailError) {
      const userWithToken = await User.findById(user._id).select(
        "+passwordResetToken +passwordResetExpires",
      );
      userWithToken.passwordResetToken = undefined;
      userWithToken.passwordResetExpires = undefined;
      await userWithToken.save({ validateBeforeSave: false });
      throw mailError;
    }

    res.status(200).json(genericResponse);
  } catch (error) {
    logger.error("auth.forgot_password_failed", {
      requestId: req.requestId,
      errorName: error.name || "Error",
    });
    res.status(500).json({
      status: "fail",
      message: "Could not send the reset email, please try again later",
    });
  }
};

// 8. RESET PASSWORD - use the link from that email

const resetPassword = async (req, res) => {
  try {
    // The token comes in the URL. The database has only the
    // HASH, so we hash what arrived and look for a match.
    // Same input always gives the same hash.
    const hashedToken = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    // One search, two conditions: the hash must match AND the
    // expiry must still be in the future. $gt = greater than.
    // This is how the 10 minute limit is enforced.
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    }).select("+passwordResetToken +passwordResetExpires");

    // Wrong token or time over - same message for both.
    if (!user) {
      throw new Error("Token is invalid or expired");
    }

    // Set the new password and confirm
    ((user.password = req.body.password),
      (user.passwordConfirm = req.body.passwordConfirm));
    // Wipe the token so the same link cannot be used twice
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

    // save() again - the hook hashes the new password
    await user.save();

    // Log him in straight away with a new token
    await AuthSession.updateMany(
      { user: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    await RefreshToken.updateMany(
      { user: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    await createSendToken(user, 200, res);
  } catch (error) {
    res.status(400).json({
      status: "fail",
      error: "Token is invalid or expired",
    });
  }
};

// 9. CHECK - who is logged in?

// The smallest one. It does no database work at all - protect
// already put the user on req. The frontend calls this after
// every page refresh, because React forgets everything: show
// the name and photo, or show the Login button.
const check = async (req, res) => {
  try {
    res.status(200).json({
      status: "success",
      message: "Logged In",
      user: req.user,
    });
  } catch (error) {
    res.status(400).json({
      status: "fail",
      message: "UnAuthorised",
    });
  }
};

// Send all 9 out. userRoutes.js imports them and decides which
// address calls which one.
export {
  signup,
  login,
  logout,
  refreshAccessToken,
  protect,
  restrictTo,
  updateMe,
  resetPassword,
  forgotPassword,
  updatePassword,
  check,
};
