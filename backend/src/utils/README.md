# Shared utilities

Utilities provide the common configuration, HTTP, persistence, validation,
logging, authentication-token, and external-service primitives used by
controllers and services.

## Direct files

- [`APIFeatures.js`](APIFeatures.js) — query helpers used by property listing.
- [`AppError.js`](AppError.js) — operational application error type for
  centralized HTTP error handling.
- [`db.js`](db.js) — Mongoose connection setup.
- [`env.js`](env.js) — required environment variable names and configuration
  validation.
- [`ImagekitIO.js`](ImagekitIO.js) — ImageKit client setup.
- [`logger.js`](logger.js) — structured logging and request-ID middleware.
- [`mail.js`](mail.js) — mail transport and password-recovery message content.
- [`razorpay.js`](razorpay.js) — Razorpay client, refund request, and payment/
  webhook signature helpers.
- [`security.js`](security.js) — rate limiters and NoSQL operator sanitization.
- [`startup.js`](startup.js) — startup sequencing so database connection,
  worker start, and listening occur in order.
- [`token.js`](token.js) — token/cookie creation, refresh-token support, and
  selected-field filtering used by authentication.
- [`validation.js`](validation.js) — Zod request schemas, request middleware,
  and parsers for AI output and Razorpay webhook events.

## Configuration and security

`env.js` requires database, signing-cookie, frontend-origin, mail, image-storage,
Groq, and Razorpay settings and validates selected formats. `security.js`
provides API/auth/AI/payment rate limiters and rejects NoSQL operator keys.
`logger.js` assigns request IDs; the entry point captures the raw JSON body so
Razorpay webhook signatures can be checked.

## Validation and API errors

`validation.js` exports `requestSchemas`, `validateRequest`,
`parseAiTripOutput`, and `parseRazorpayWebhookEvent`. Route-level validation
stores parsed data and rejects invalid input with a common 400 response.
`AppError.js` supplies the operational error type used by the centralized
handler in `index.js`; logs and production responses are designed not to expose
database details or credential values.

## Authentication cookies and sessions

The current implementation is in [`token.js`](token.js),
[`controllers/authController.js`](../controllers/authController.js), and
[`models/authSessionModel.js`](../models/authSessionModel.js):

- Successful signup/login, password update/reset, and refresh set two signed
  cookies: `jwt` (the access JWT) and `refreshToken` (an opaque refresh token).
  The set options for both are `HttpOnly`, `SameSite=Strict`, `Secure` only
  when `NODE_ENV === "production"`, `path: "/api/v1/rent"`, an absolute
  `expires` date, and `signed: true`.
- Access-cookie expiry comes from `JWT_ACCESS_EXPIRES_IN`, default `15m`.
  `token.js` accepts an integer followed by `s`, `m`, `h`, or `d`, and enforces
  a range of 1 second through 1 hour. The JWT also embeds its expiration.
- Refresh-cookie/session expiry uses `JWT_REFRESH_EXPIRES_DAYS`, default 30
  days, constrained to 1–90 days. Refresh tokens are random 32-byte
  base64url strings; only their SHA-256 hashes are persisted.
- Refresh validates the unconsumed token and active session, consumes the old
  token with a `replacedByHash`, creates a new token/hash, extends the session
  expiry, and issues a new access JWT for the same session. Reuse/invalidity
  leads to session revocation when applicable and a 401 response.
- Logout is public and attempts to identify the session from the refresh-token
  hash, or from the access JWT (signed cookie or bearer token, allowing an
  expired JWT for this lookup). It revokes that session and its refresh tokens,
  then calls `clearCookie` for both names at both `/api/v1/rent` and
  `/api/v1/rent/user` (four clear-cookie calls total). Each clearing call passes
  `httpOnly: true`, `sameSite: "strict"`, the same production-only `secure`
  setting, and its path; it does not pass `signed` or an explicit expiry option.
  It returns 200 even if no session can be identified, provided storage
  operations do not error.
- Password update/reset revokes the user's existing sessions and refresh tokens,
  then creates a fresh session and cookie pair. `protect` accepts either a
  bearer access token or the signed `jwt` cookie and also checks session
  revocation/expiry in MongoDB.

## Relationships and boundaries

`index.js` composes logger, security, database, startup, and error helpers.
Routers invoke request schemas and rate limiters; authentication handlers use
token and mail helpers; booking/refund services use the database, Razorpay, and
logging helpers. `env.js` reports configuration issues by variable name; do not
put credential values in logs or documentation. Webhook signatures depend on
the raw body captured by the Express JSON parser.

Parent: [`src/`](../README.md). Related:
[`controllers/`](../controllers/README.md), [`routes/`](../routes/README.md),
[`services/`](../services/README.md), [`ai/`](../ai/README.md).
