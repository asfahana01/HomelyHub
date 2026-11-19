# `components/aiTripPlanner/`

| File | Responsibility / key exports |
| --- | --- |
| [`AiTripPlanner.jsx`](AiTripPlanner.jsx) | Default-exported trip-planning form and result page; calls `getTripPlan` and renders its returned data. |

`getTripPlan` posts the submitted trip to the backend through the shared Axios client; see [`src/ai/`](../../ai/README.md). Styling is in [`css/AiTripPlanner.css`](../../css/README.md), also used by the site header.

Parent: [`components/`](../README.md).
