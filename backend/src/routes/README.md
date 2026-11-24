# API route reference

These are the router declarations mounted by [`../index.js`](../index.js).
Response shapes below are limited to what the current controllers return.
Unless a route says otherwise, a request rejected by `validateRequest` receives
HTTP 400 with:

```json
{
  "status": "fail",
  "message": "Invalid request data",
  "errors": [{ "path": "field", "message": "validation detail" }]
}
```

Request schemas are strict where noted: unknown fields are rejected. Numeric
values described as accepting number-or-string are normalized to numbers by the
schema; unspecified content types and additional controller-level errors are
not inferred here.

## Account and user-router routes

All paths in this section are under `/api/v1/rent/user`.

| Method and path | Access | Query / path / body | Success response and controller errors |
| --- | --- | --- | --- |
| `POST /signup` | Public; auth rate limiter | Body `signup`: `name` (trimmed, 2–20 chars), `email` (valid, max 254, lowercased), `phoneNumber` (7–20 chars matching `^[+\\d\\s()-]+$`), `password` and `passwordConfirm` (6–128 chars, equal), optional `avatar` (empty, HTTP(S) URL, or JPEG/PNG/WEBP data URL, max 7,000,000 chars). Unknown keys rejected. | `201 { status: "Success", user }`; signed auth cookies are set. Password/reset-token fields are removed from the returned user. Duplicate account or creation error: `400 { status: "fail", message }`. |
| `POST /login` | Public; auth rate limiter | Body `login`: valid email (max 254, lowercased) and nonempty password (max 128). Unknown keys rejected. | `200 { status: "Success", user }` and auth cookies. Invalid credentials: `401 { status: "fail", message: "Incorrect email or password" }`. |
| `GET /logout` | Public | Query `emptyQuery`: no query keys allowed. | `200 { status: "success", message: "Logged out successfully" }`; revokes a resolvable session and clears cookies. |
| `POST /logout` | Public | Body `emptyBody`: no body keys allowed. | Same response and clearing behavior as `GET /logout`. |
| `POST /refresh-token` | Public route; requires the signed refresh cookie to refresh | Body `emptyBody`: no body keys allowed. | `200 { status: "Success", user }` and rotated auth cookies. Invalid/expired/reused refresh token: `401 { status: "fail", message }` and cookie-clearing attempts. |
| `PATCH /updateMe` | Authenticated | Body `profile`: at least one of optional `name` (2–20 chars), `phoneNumber` (7–20 chars, same phone pattern), or `avatar` (same formats/size as signup); unknown keys rejected. | `200 { status: "Success", data: { user } }`. Controller failure: `400 { status: "Fail", message: "Could not update profile. Please try again." }`. |
| `PATCH /updateMyPassword` | Authenticated | Body `updatePassword`: `passwordCurrent` (1–128 chars), `password` and `passwordConfirm` (6–128 chars, equal); unknown keys rejected. | `200 { status: "Success", user }` and new auth cookies. Wrong current password: `401 { status: "fail", message }`; other controller failures: `400` with a generic message. |
| `POST /forgotPassword` | Public; auth rate limiter | Body `forgotPassword`: valid email (max 254, lowercased); unknown keys rejected. | `200 { status: "success", message: "If that email is registered, a reset link has been sent" }` whether or not the account exists. Mail/processing error: `500 { status: "fail", message }`. |
| `PATCH /resetPassword/:token` | Public; auth rate limiter | Path `token`: exactly 64 hexadecimal characters. Body `resetPassword`: `password` and `passwordConfirm` (6–128 chars, equal); unknown keys rejected. | `200 { status: "Success", user }` and new auth cookies. Invalid/expired token or controller error: `400 { status: "fail", error: "Token is invalid or expired" }`. |
| `GET /me` | Authenticated | No route-level query/body schema. | `200 { status: "success", message: "Logged In", user }`. Authentication failures are `401`; see [authentication errors](#authentication-and-common-errors). |
| `GET /admin/users` | Authenticated, admin role | Query `adminUserList`: `page` integer ≥1, default 1; `limit` integer 1–100, default 20. Both are coerced from query strings; unknown keys rejected. | `200 { status: "success", data: { users, pagination: { page, limit, total, pages } } }`; each user selects name/email/role/createdAt. Transaction is not involved in listing. |
| `PATCH /admin/users/:userId/role` | Authenticated, admin role | Path `userId`: 24-hex ObjectId. Body `updateUserRole`: `role` is `"user"` or `"admin"`; unknown keys rejected. | `200 { status: "success", data: { user } }` (name/email/role/createdAt selected). Errors include 404 user missing, 409 self-demotion/last-admin/concurrent-change constraints, and 503 when MongoDB transactions are unavailable. |
| `POST /createTripPlan` | Authenticated; AI rate limiter and usage quota (2,000 estimated output tokens) | Body `tripPlan`: `destination` (trimmed, 2–100 chars); `budget` positive number or decimal-digit string, ≤10,000,000; `days` integer 1–30; `people` integer 1–30; optional `interests` array of up to 10 values from Beach, Food, Nightlife, Nature, Adventure, Shopping, History, Relaxation (defaults to `[]`). Unknown keys rejected. | Same handler as `POST /api/v1/rent/trip`: `200 { status: "success", data: { plan, properties, perNight } }`; generation/output errors: `500 { status: "fail", message }`. |
| `POST /newAccommodation` | Authenticated, admin role | Body `createProperty` (also used for listing creation; `isActive` is not accepted): required `propertyName` (2–150), `description` (20–5,000), `propertyType` (`House`, `Flat`, `Guest House`, `Hotel`, `villa`, `Resort`), `roomType` (`Anytype`, `Room`, `Entire Home`), `address`, `amenities`, `maximumGuest`, `price`, and `images`; optional `extraInfo` (≤1,000), `checkInTime`, `checkOutTime`. `address` requires area/city/state (1–100 chars each) and pincode (integer 1,000–9,999,999 or 4–7 digit string). `amenities` is an array (≤20) of strict `{name, icon}` objects; name is one of wifi/Kitchen/Ac/Washing Machine/Tv/Pool/Free Parking, icon 1–80 chars. `maximumGuest` is number/decimal-digit string → integer 1–100; `price` is number/decimal-digit string → 1–1,000,000. `images` is 6–15 strict `{url, public_id?}` entries; URL is HTTP(S) or JPEG/PNG/WEBP image data URL, `public_id` ≤200 chars. Unknown keys rejected. | Same `createProperty` handler as `POST /api/v1/rent/listing`: `201 { status: "success", data: { data: property } }`; controller errors use `400 { status: "fail", message }`. |
| `GET /myAccommodation` | Authenticated, admin role | No route-level query/body schema. | `200 { status: "success", data: properties }`; controller failure: `500 { status: "fail", message }`. Despite the route name, the controller queries non-archived platform properties, not just records owned by the caller. |
| `POST /generateDescription` | Authenticated, admin role; AI rate limiter and usage quota (500 estimated output tokens) | Body `propertyDescription`: required `propertyName` (2–150 chars); optional `extraInfo` (≤1,000), `propertyType` and `roomType` from the property enums, `maximumGuest` (integer 1–100, number/string; empty/zero treated as omitted), `amenities` (≤20 valid amenity entries), `price` (1–1,000,000, number/string; empty/zero omitted), and partial `address` fields (`area/city/state` ≤100; pincode integer 1,000–9,999,999 or 0–7 digit string). Unknown keys rejected. | `200 { status: "success", data: { description } }`; generation/output failure: `500 { status: "fail", message }`. |

## Property listing routes

Paths are under `/api/v1/rent/listing`.

| Method and path | Access | Query / path / body | Success response and controller errors |
| --- | --- | --- | --- |
| `GET /` | Public | No `requestSchemas` query validator is installed. `APIFeatures` reads `minPrice`, `maxPrice`, `propertyType` (comma-separated), `roomType`, `amenities` (single/repeated), `city`, `guests`, `dateIn`, `dateOut`, `page`, and `limit`. These inputs are not schema-bounded by this route. | `200 { status: "success", no_of_responses, data: properties }`; query failure: `500 { status: "error", message }`. |
| `GET /:id` | Public | Path `id`: 24-hex ObjectId. No query/body schema. | `200 { status: "success", data: property }`; absent/invalid lookup: `404 { status: "fail", message: "Property not found" }`. |
| `POST /` | Authenticated, admin role | Body `createProperty`, as described for `POST /api/v1/rent/user/newAccommodation`; `isActive` is excluded. | `201 { status: "success", data: { data: property } }`; invalid input is 400 from middleware or controller. |
| `PATCH /:id` | Authenticated, admin role | Path `id`: 24-hex ObjectId. Body `updateProperty`: nonempty partial property fields, including optional `isActive`; fields use the same property constraints. Unknown keys rejected. | `200 { status: "success", data: property }`; 404 if absent; controller save/validation errors return 400. |
| `DELETE /:id` | Authenticated, admin role | Path `id`: 24-hex ObjectId. Body `emptyBody`: no keys allowed. | `200 { status: "success", message }`; when future/active paid bookings exist, response also has `archived: true`. Missing property: 404; controller failure: 500. The controller archives rather than physically deleting. |

## Booking and Razorpay routes

Paths are under `/api/v1/rent/user/booking`.

| Method and path | Access | Query / path / body | Success response and controller errors |
| --- | --- | --- | --- |
| `GET /` | Authenticated | No route-level query/body schema. | `200 { status: "success", data: { bookings, cancellationPolicy } }`; only the caller's paid bookings are queried. Failure: 500. |
| `GET /:bookingId` | Authenticated | Path `bookingId`: 24-hex ObjectId. | `200 { status: "success", data: { bookings: booking, cancellationPolicy } }`; missing or non-owned booking: 404. |
| `POST /:bookingId/cancel` | Authenticated; payment rate limiter | Path `bookingId`: 24-hex ObjectId. Body `emptyBody`: no keys allowed. | `202 { success: true, message, data: { booking, refund: { status: "pending", amount, currency }, cancellationPolicy } }`. Controller errors use their status code (e.g. eligibility/ownership conflicts); unexpected failure: 500 with a generic message. |
| `POST /create-order` | Authenticated; payment rate limiter | Body `createOrder`: `propertyId` 24-hex ObjectId; `fromDate`/`toDate` calendar dates; `guests` integer 1–100 (JSON number). Unknown keys rejected. | `201 { success: true, message, orderId, amount, currency, keyId, propertyName, bookingId, nights, calculatedPrice }`. Controller handles unavailable property (404), invalid dates/guests (400), date conflict (409), gateway failure (502), order-link persistence failure (503), and generic failure (500). |
| `POST /verify-payment` | Authenticated; payment rate limiter | Body `verifyPayment`: `razorpay_order_id` matching `order_...`, `razorpay_payment_id` matching `pay_...`, and 64-hex `razorpay_signature`; unknown keys rejected. | `200 { success: true, message, booking }` when confirmed/already confirmed. Captured payment with unavailable dates: 409 with `booking` and refund-pending message. Invalid signature: 400; gateway fetch failure: 502; service/controller errors use status code or 500. |
| `POST /webhook` | Public delivery endpoint; Razorpay signature required (not user-authenticated) | Header `x-razorpay-signature` and raw JSON body required. Optional `x-razorpay-event-id`; absent ID is derived from raw-body SHA-256. `event` is a nonempty string up to 100 chars. `payment.captured` requires `payload.payment.entity` with `id` (`pay_…`), `order_id` (`order_…`), positive integer `amount`, `currency: "INR"`, and `status: "captured"`. `payment.failed` requires that entity's payment/order IDs and `status: "failed"`. Refund events require `payload.refund.entity` (`id: rfnd_…`, `payment_id: pay_…`, positive integer amount, INR currency, event-matching processed/failed status, optional string-valued `notes`) and `payload.payment.entity` (payment/order IDs, positive integer amount, INR currency). Event/entity schemas allow extra gateway fields. Other event names pass the generic event schema and are acknowledged without a matching state transition. | `200 { status: "success" }` on successful processing and duplicate/already-claimed delivery. Missing/invalid signature or malformed event: 400; event-claim failure: 503; processing failure returns a controller/service status or 500. |

## AI trip-planning route

`POST /api/v1/rent/trip` is authenticated, AI-rate-limited, validated with the
same `tripPlan` schema as `/api/v1/rent/user/createTripPlan`, and checked by
daily usage middleware (2,000 estimated output tokens). It returns
`200 { status: "success", data: { plan, properties, perNight } }` on success
and a generic 500 response if generation/output handling fails.

## Other application routes

These are declared directly in `src/index.js`, not in a router:

| Method and path | Access | Response |
| --- | --- | --- |
| `GET /` | Public | `200` with a plain-text backend-running message. |
| `GET /health` | Public | `200 { status: "ok" }`; liveness only. |
| `GET /ready` | Public | JSON `status` and component status labels; returns 200 when configured/ready, otherwise 503. It does not expose credential values. |
| unmatched method/path | Public | `404 { status: "fail", message }`. |

## Authentication and common errors

`protect` accepts a bearer access token or the signed `jwt` cookie and requires
an active, non-revoked database session. Missing, expired, or invalid tokens
and revoked sessions return 401. `restrictTo("admin")` returns 403 when the
authenticated account lacks the required role.

Authentication cookie names, options, expiry, refresh-token rotation, session
revocation, and logout clearing behavior are documented in
[`utils/README.md#authentication-cookies-and-sessions`](../utils/README.md#authentication-cookies-and-sessions).

The application error handler returns `{ status, message, requestId }`; it
exposes operational client errors below 500 and substitutes a generic message
for unexpected/server errors.

## Related files

- [`userRoutes.js`](userRoutes.js), [`propertyRouter.js`](propertyRouter.js),
  [`bookingRouter.js`](bookingRouter.js), [`tripRouter.js`](tripRouter.js) —
  route and middleware declarations.
- [`controllers/`](../controllers/README.md) — request handling and response
  bodies.
- [`utils/validation.js`](../utils/validation.js) — `requestSchemas` and event
  parsers.
- [`services/`](../services/README.md) — booking/payment/refund workflow.

Parent: [`src/`](../README.md). Backend overview: [`../../README.md`](../../README.md).
