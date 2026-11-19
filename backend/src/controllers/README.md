# Controllers

Controllers translate validated Express requests into application operations
and responses. Route wiring, access controls, and endpoint paths are documented
in [`routes/`](../routes/README.md); persistence schemas are in
[`models/`](../models/README.md).

## Direct files and responsibilities

- [`adminUserController.js`](adminUserController.js) — paginated admin user
  listing and role changes, including transactional role-change auditing and
  protection against demoting the last administrator.
- [`aiController.js`](aiController.js) — property-description generation via
  [`ai/`](../ai/README.md).
- [`authController.js`](authController.js) — signup/login/logout, access
  protection, role restriction, refresh, profile/password updates, password
  recovery, and current-user lookup.
- [`bookingController.js`](bookingController.js) — booking reads, checkout order
  creation, payment verification, Razorpay webhook dispatch, and customer
  cancellation.
- [`propertyController.js`](propertyController.js) — public property reads and
  administrator property CRUD, including image-related integration.
- [`tripController.js`](tripController.js) — trip-plan request handling and
  property/destination context passed to the AI planner.

## Dependencies and flow

Handlers use the Mongoose models, shared request validation, error/logger and
integration utilities, and domain services. Booking confirmation and refund
state transitions are delegated to [`services/`](../services/README.md), rather
than being independent controller-only state changes. The router applies
`protect`, role restrictions, rate limits, and schema validators before these
handlers. For exact exported handler names, see the import/export declarations
in each source file.

Parent: [`src/`](../README.md). Related:
[`routes/`](../routes/README.md), [`models/`](../models/README.md),
[`services/`](../services/README.md), [`ai/`](../ai/README.md).
