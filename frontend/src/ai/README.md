# `ai/`

Thin API helpers for AI-powered product features. Both use the shared credentialed Axios client; the AI generation itself is performed by backend endpoints.

| File | Responsibility / key exports |
| --- | --- |
| [`aiDescription.js`](aiDescription.js) | Exports `getAiDescription(values)`; POSTs selected accommodation fields to `/v1/rent/user/generateDescription` and returns `data.data.description`. Used by the accommodation form. |
| [`tripPlanner.js`](tripPlanner.js) | Exports `getTripPlan(trip)`; POSTs trip input to `/v1/rent/trip` and returns `data.data`. Used by the AI trip planner page. |

Parent: [`src/`](../README.md); consumer pages are listed in [`components/`](../components/README.md).
