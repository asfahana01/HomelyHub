# `utils/`

| File | Responsibility / key exports |
| --- | --- |
| [`axios.js`](axios.js) | Creates and named-exports `axiosInstance` with `/api` base URL, cookies enabled, and repeated-array query serialization. A response interceptor shares a refresh-token request after eligible 401 responses, then retries the original request once. |

This client is used by Redux action modules and the AI helpers. Vite's development proxy forwards `/api` to `http://localhost:3000`; see [`vite.config.js`](../../vite.config.js). Login, signup, refresh, forgot-password, and reset-password requests are excluded from the interceptor's automatic retry.

Parent: [`src/`](../README.md).
