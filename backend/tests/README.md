# Backend tests

The tests use Node's built-in `node:test` runner and are invoked with `npm test`
from `backend/`. Most integration boundaries are stubbed or mocked; passing
tests do not establish behavior against a live MongoDB deployment, email/image
provider, Groq, or Razorpay account.

## Direct files

- [`admin-user-management.test.js`](admin-user-management.test.js) — admin role
  audit transactions and last-admin protection.
- [`ai-usage.test.js`](ai-usage.test.js) — atomic daily usage reservation and
  quota rejection.
- [`auth-lifecycle.test.js`](auth-lifecycle.test.js) — access/refresh session
  lifecycle, logout revocation, and cookie responses.
- [`booking-access.test.js`](booking-access.test.js) — caller-scoped booking
  reads and rejection of unsafe IDs/payment fields.
- [`booking-cancellation.test.js`](booking-cancellation.test.js) — cancellation
  eligibility, ownership, refund-task creation, idempotency/retries, worker
  reconciliation, and refund webhook state changes.
- [`booking-payment.test.js`](booking-payment.test.js) — payment verification,
  webhook signatures/deduplication, checkout holds, claim leases, retries, and
  startup/worker sequencing.
- [`env-validation.test.js`](env-validation.test.js) — required configuration
  checks, including avoiding disclosure of setting values.
- [`http-security.test.js`](http-security.test.js) — authentication requirements
  and liveness/readiness behavior.
- [`input-ai-security.test.js`](input-ai-security.test.js) — strict request
  validation, prompt escaping, and AI output validation.
- [`security.test.js`](security.test.js) — token/signature checks, role and
  filtering helpers, booking defaults, and NoSQL sanitization.

Coverage is set to a 60% statement threshold by `npm run test:coverage`. This
documents the configured gate only; whether the current tree meets it must be
determined by running the command. No live-service or replica-set integration
suite is declared by the package scripts.

Parent: [`backend/`](../README.md). Related implementation:
[`src/`](../src/README.md), especially
[`services/`](../src/services/README.md),
[`routes/`](../src/routes/README.md), and
[`utils/`](../src/utils/README.md).
