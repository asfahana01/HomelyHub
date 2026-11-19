# Data models

Mongoose schemas in this folder persist identity, property, booking, payment
recovery, administrative audit, and AI usage state. Controllers and services
coordinate writes; transactional guarantees depend on MongoDB transaction
support and are not proven by mocked unit tests.

## Direct files

- [`adminRoleLockModel.js`](adminRoleLockModel.js) — lock state used to coordinate
  administrator-role changes.
- [`aiUsageModel.js`](aiUsageModel.js) — per-user AI usage accounting.
- [`authSessionModel.js`](authSessionModel.js) — authentication-session and
  refresh-token records.
- [`bookingModel.js`](bookingModel.js) — reservation, payment, and cancellation
  lifecycle data.
- [`propertyModel.js`](propertyModel.js) — property listing schema and
  slug-related behavior.
- [`refundTaskModel.js`](refundTaskModel.js) — durable payment-refund work,
  retries, status, and worker claim/idempotency state.
- [`roleChangeAuditModel.js`](roleChangeAuditModel.js) — administrator role
  change audit entries.
- [`userModel.js`](userModel.js) — user identity, credentials, and account data.
- [`webhookEventModel.js`](webhookEventModel.js) — persisted webhook event
  processing/deduplication and claim state.

## Relationships

Bookings reference properties and users; refund tasks reconcile against bookings
and gateway payment/refund identifiers. Webhook event and refund-task models are
consumed by the services that claim/process work. Auth sessions and refresh
tokens are used by the auth controller and token utilities. AI usage and admin
audit/lock records are coordinated by their respective services/controllers.

Parent: [`src/`](../README.md). Related:
[`controllers/`](../controllers/README.md),
[`services/`](../services/README.md),
[`utils/`](../utils/README.md).
