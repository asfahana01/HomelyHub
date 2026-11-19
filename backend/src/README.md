# Backend source

This directory contains the Express application entry point and the modules it
wires together. `index.js` mounts the API routers, middleware, health/readiness
routes, and startup sequence; the service and controller layers implement the
business flows.

## Direct files

- [`index.js`](index.js) — application configuration, route mounts, error
  handling, and non-test startup.

## Runtime flow

The entry point loads dotenv configuration and validates required settings
outside test mode, adds request IDs, Helmet, credentialed CORS, JSON/urlencoded
parsing, cookie parsing, NoSQL sanitization, and API rate limiting. JSON parsing
retains the raw request body for webhook signature verification. It mounts
`/api/v1/rent/user`, `/api/v1/rent/listing`,
`/api/v1/rent/user/booking`, and `/api/v1/rent/trip`, then applies a JSON 404
and centralized error handler. Outside test mode, startup connects to MongoDB,
starts the refund worker, and begins listening.

## Modules

- [`ai/`](ai/README.md) — Groq client, prompt construction, and AI output checks.
- [`controllers/`](controllers/README.md) — HTTP handlers and auth/admin middleware.
- [`models/`](models/README.md) — Mongoose persistence schemas.
- [`routes/`](routes/README.md) — endpoint-to-middleware/controller wiring.
- [`scripts/`](scripts/README.md) — environment, syntax, and admin maintenance scripts.
- [`services/`](services/README.md) — booking confirmation, refunds, webhook claims,
  and AI quota coordination.
- [`utils/`](utils/README.md) — configuration, database, validation, security,
  logging, and external integrations.

See the [backend overview](../README.md) for commands, configured environment
variable names, and the API outline.
