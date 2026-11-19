# AI integration

This folder isolates Groq client setup, prompt preparation, and validation of
AI-generated trip plans and property descriptions. Callers are in
[`controllers/`](../controllers/README.md); request and output schemas are in
[`utils/validation.js`](../utils/README.md#validation-and-api-errors).

## Direct files

- [`aiClient.js`](aiClient.js) — creates and exports the Groq SDK client using
  `GROQ_API_KEY`.
- [`generateDescription.js`](generateDescription.js) — generates a property
  description from supplied property details.
- [`promptSecurity.js`](promptSecurity.js) — escapes user-provided prompt text,
  parses JSON trip output through the shared schema, and constrains description
  output to a trimmed string of 200–2,000 characters.
- [`tripPlanner.js`](tripPlanner.js) — builds the travel-planning prompt, calls
  Groq with JSON response formatting, and validates the returned plan.

## Relationships and limits

`tripController` calls `planTrip`; `aiController` calls
`generateDescription`. Routes enforce authentication/administrator access,
request validation, rate limits, and daily usage accounting before invoking
these operations. Prompt escaping and schema validation constrain inputs and
shape, but do not independently verify factual claims returned by the model.

Parent: [`src/`](../README.md). Related:
[`controllers/`](../controllers/README.md),
[`services/`](../services/README.md), [`utils/`](../utils/README.md).
