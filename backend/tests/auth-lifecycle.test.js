import { test, describe } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { AuthSession, RefreshToken } from "../src/models/authSessionModel.js";
import { User } from "../src/models/userModel.js";
import {
  logout,
  refreshAccessToken,
} from "../src/controllers/authController.js";
import {
  createSendToken,
  hashRefreshToken,
} from "../src/utils/token.js";

const userId = "64b7f123456789abcdef0789";
const secret = "test_auth_secret_at_least_32_characters_long";

const configureAuth = (t) => {
  const previous = {
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN,
    JWT_REFRESH_EXPIRES_DAYS: process.env.JWT_REFRESH_EXPIRES_DAYS,
    COOKIE_SECRET: process.env.COOKIE_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  };
  process.env.JWT_SECRET = secret;
  process.env.JWT_ACCESS_EXPIRES_IN = "15m";
  process.env.JWT_REFRESH_EXPIRES_DAYS = "30";
  process.env.COOKIE_SECRET = "test_cookie_secret_at_least_32_chars";
  process.env.NODE_ENV = "test";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
};

const response = () => ({
  cookies: [],
  statusCode: null,
  body: null,
  cookie(name, value, options) {
    this.cookies.push({ name, value, options });
    return this;
  },
  clearCookie(name, options) {
    this.cookies.push({ name, options, cleared: true });
    return this;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

describe("authentication session lifecycle", () => {
  test("creates a short-lived signed access cookie and omits the token from JSON", async (t) => {
    configureAuth(t);
    t.mock.method(AuthSession, "create", async (value) => value);
    t.mock.method(RefreshToken, "create", async (value) => value);

    const res = response();
    await createSendToken(
      {
        _id: userId,
        name: "Test User",
        password: "not-returned",
        toObject() {
          return {
            _id: userId,
            name: "Test User",
            password: "not-returned",
          };
        },
      },
      200,
      res
    );

    const accessCookie = res.cookies.find(({ name }) => name === "jwt");
    const refreshCookie = res.cookies.find(
      ({ name }) => name === "refreshToken"
    );
    assert.ok(accessCookie.options.signed);
    assert.ok(refreshCookie.options.signed);
    assert.equal(accessCookie.options.httpOnly, true);
    assert.equal(accessCookie.options.sameSite, "strict");
    assert.equal(accessCookie.options.path, "/api/v1/rent");
    const decoded = jwt.verify(accessCookie.value, secret);
    assert.equal(decoded.id, userId);
    assert.ok(decoded.sid);
    assert.ok(decoded.exp - decoded.iat <= 900);
    assert.equal(res.body.token, undefined);
    assert.equal(res.body.user.password, undefined);
  });

  test("rotates refresh tokens and returns no credential in the response body", async (t) => {
    configureAuth(t);
    const rawToken = "current-refresh-token";
    const sessionId = "session-test";
    const storedToken = {
      _id: "refresh-document",
      sessionId,
      user: userId,
      tokenHash: hashRefreshToken(rawToken),
      consumedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const session = {
      sessionId,
      user: userId,
      expiresAt: new Date(Date.now() + 60_000),
      async save() {},
    };
    let updateFilter;
    let newRefreshToken;
    t.mock.method(RefreshToken, "findOne", async () => storedToken);
    t.mock.method(AuthSession, "findOne", async () => session);
    t.mock.method(User, "findById", async () => ({
      _id: userId,
      name: "Test User",
    }));
    t.mock.method(RefreshToken, "findOneAndUpdate", async (filter) => {
      updateFilter = filter;
      return storedToken;
    });
    t.mock.method(RefreshToken, "create", async (value) => {
      newRefreshToken = value;
      return value;
    });

    const res = response();
    await refreshAccessToken(
      { signedCookies: { refreshToken: rawToken } },
      res,
      (error) => {
        throw error;
      }
    );

    assert.equal(res.statusCode, 200);
    assert.equal(updateFilter.consumedAt, null);
    assert.equal(newRefreshToken.sessionId, sessionId);
    assert.equal(res.body.token, undefined);
    assert.equal(res.cookies.length, 2);
    const rotatedCookie = res.cookies.find(
      ({ name }) => name === "refreshToken"
    );
    assert.equal(newRefreshToken.tokenHash, hashRefreshToken(rotatedCookie.value));
  });

  test("logout revokes the backing session and clears both signed cookies", async (t) => {
    configureAuth(t);
    let sessionFilter;
    let refreshFilter;
    t.mock.method(RefreshToken, "findOne", () => ({
      select: async () => ({ sessionId: "session-to-revoke" }),
    }));
    t.mock.method(AuthSession, "updateOne", async (filter) => {
      sessionFilter = filter;
      return { matchedCount: 1 };
    });
    t.mock.method(RefreshToken, "updateMany", async (filter) => {
      refreshFilter = filter;
      return { modifiedCount: 1 };
    });

    const res = response();
    await logout(
      {
        signedCookies: { refreshToken: "refresh-cookie" },
        headers: {},
      },
      res,
      (error) => {
        throw error;
      }
    );

    assert.deepEqual(sessionFilter, {
      sessionId: "session-to-revoke",
      revokedAt: null,
    });
    assert.equal(refreshFilter.sessionId, "session-to-revoke");
    const clearedCookies = res.cookies.filter((cookie) => cookie.cleared);

assert.equal(clearedCookies.length, 4);

for (const name of ["jwt", "refreshToken"]) {
  const paths = clearedCookies
    .filter((cookie) => cookie.name === name)
    .map((cookie) => cookie.options.path);

  assert.deepEqual(paths.sort(), [
    "/api/v1/rent",
    "/api/v1/rent/user",
  ].sort());
}
    assert.equal(res.statusCode, 200);
  });
});
