# Backend

The backend is the Express/Mongoose API for HomelyHub. It owns account and session
handling, property administration, booking/payment state, refund processing, and
AI-assisted planning and property descriptions. The application entry point and
route mounts are in [`src/README.md`](src/README.md).

## Direct files

- [`package.json`](package.json) — Node package metadata, dependencies, and commands.
- [`package-lock.json`](package-lock.json) — locked npm dependency graph.
- [`.env.example`](.env.example) — configuration variable names and example
  placeholders. Do not copy real credentials into documentation or commit them.

## Run and check

Install dependencies with `npm install`. From this directory:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start `src/index.js` in the current Node process. |
| `npm test` | Run the Node built-in test runner over `tests/`. |
| `npm run check:syntax` | Check JavaScript syntax in the project source. |
| `npm run check:env` | Check that the environment template and required names stay aligned. |
| `npm run test:coverage` | Run tests with `c8`; the configured statement threshold is 60%. |

`src/index.js` validates configuration (except in test mode), configures Express
middleware and route mounts, connects to MongoDB, starts the refund worker, and
then listens. `/health` is a liveness response; `/ready` reports database and
integration configuration status without returning credential values.

## Configuration names

The checked-in template names these settings: `PORT`, `NODE_ENV`,
`FRONTEND_URL`, `ORIGIN_ACCESS_URL`, `MONGO_URI`, `JWT_SECRET`,
`COOKIE_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_DAYS`,
`MAILTRAP_SMTP_HOST`, `MAILTRAP_SMTP_PORT`, `MAILTRAP_SMTP_USER`,
`MAILTRAP_SMTP_PASS`, `IMAGE_PUBLICKEY`, `IMAGE_PRIVATEKEY`,
`IMAGEKIT_URLENDPOINT`, `GROQ_API_KEY`, `AI_DAILY_TOKEN_LIMIT`,
`AI_DAILY_REQUEST_LIMIT`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET`, `REFUND_WORKER_INTERVAL_MS`,
`REFUND_MAX_ATTEMPTS`, and `BOOKING_CANCELLATION_CUTOFF_HOURS`.
Requiredness and format checks are implemented in
[`src/utils/env.js`](src/utils/README.md#configuration-and-security); the template
alone does not establish that every integration is enabled in a deployment.

## API outline

The mounts below are wired by `src/index.js`; endpoint behavior is implemented in
the linked routers and controllers. These are source-level references, not a
claim that a live deployment has been exercised.

- `/api/v1/rent/user` — account/session endpoints, administrator user management,
  admin property-creation helpers, AI description generation, and a trip-plan
  endpoint. See [`routes`](src/routes/README.md).
- `/api/v1/rent/listing` — public property list/detail and administrator
  create/update/delete endpoints.
- `/api/v1/rent/user/booking` — authenticated booking list/detail, order creation,
  payment verification, and cancellation; `/webhook` is publicly reachable and
  verifies Razorpay signatures before processing.
- `/api/v1/rent/trip` — authenticated, rate-limited trip planning.
- `/health`, `/ready`, and `/` — liveness/readiness/root responses.

## Architecture and operational boundaries

- **Authentication and admin access:** the auth controller issues and revokes
  sessions; route middleware protects private APIs and checks administrator
  roles. Admin role changes use audit and role-lock models.
- **Bookings and payment:** booking routes validate request data; the controller
  verifies checkout signatures and webhooks, while booking-confirmation services
  enforce payment and availability rules using MongoDB transactions.
- **Refunds and webhooks:** refund tasks are persisted and processed by a
  background worker; webhook event claims support deduplication and leases.
  Cancellation eligibility and gateway reconciliation are handled in the refund
  service. Transaction behavior requires a MongoDB deployment that supports
  transactions; the unit tests use mocks and do not establish production
  concurrency behavior.
- **AI:** controller/route limits and daily usage accounting wrap Groq-backed
  generation. Generated trip-plan and description output is parsed/validated
  before use; see [`ai`](src/ai/README.md) and
  [`services`](src/services/README.md).
- **Input and HTTP safeguards:** request schemas are in `utils/validation.js`;
  security middleware, rate limits, request IDs, and error responses are wired
  in the application entry point.

## Subdirectories

- [`src/`](src/README.md) — application entry point and runtime modules.
- [`tests/`](tests/README.md) — Node test-runner coverage, primarily using
  dependency stubs/mocks rather than live external services.
