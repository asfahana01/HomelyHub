# Backend services

Services coordinate multi-record workflows and durable background work that
should not be implemented as isolated HTTP-handler side effects.

## Direct files

- [`aiUsageService.js`](aiUsageService.js) — reserves daily per-user AI request
  and estimated-token usage and exposes middleware for endpoint quotas.
- [`bookingConfirmationService.js`](bookingConfirmationService.js) — checkout
  holds, captured-payment validation, transaction-based booking confirmation,
  and payment-failure handling.
- [`refundService.js`](refundService.js) — cancellation eligibility and policy,
  refund-task creation, claim/lease ownership, retries, gateway reconciliation,
  and refund webhook transitions.
- [`refundWorker.js`](refundWorker.js) — creates/starts the recurring worker
  that runs pending refund work.
- [`webhookEventService.js`](webhookEventService.js) — claims webhook events and
  marks processing success/failure while preventing stale claims from
  overwriting newer ownership.

## Payment, webhook, and refund flow

Booking controllers validate checkout requests and delegate successful payment
confirmation to `bookingConfirmationService`. The Razorpay webhook handler
verifies signatures and uses `webhookEventService` for event deduplication.
Cancellation is handled by `refundService`: it applies the configured cutoff,
checks payment details, records refund work with booking/date state changes in a
transaction, and lets the worker submit/reconcile the refund. Refund status
webhooks are validated and matched before updating task and booking state.

These flows use Razorpay and MongoDB integrations via `utils/`; transaction
availability is required for transactional operations. Unit tests use mocks,
so no real gateway or replica-set behavior is asserted here. Retry limits and
worker cadence are configurable; review the template and implementation before
deployment.

Parent: [`src/`](../README.md). Related:
[`models/`](../models/README.md), [`controllers/`](../controllers/README.md),
[`utils/`](../utils/README.md), [`tests/`](../../tests/README.md).
