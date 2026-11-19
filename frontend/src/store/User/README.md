# `store/User/`

| File | Responsibility / key exports |
| --- | --- |
| [`user-action.js`](user-action.js) | Exports `getSignup`, `getLogin`, `currentUser`, `updateUser`, `forgotPassword`, `resetPassword`, `updatePassword`, and `logout`; calls the corresponding `/v1/rent/user/...` endpoints. |
| [`user-slice.js`](user-slice.js) | Default-exports the user slice; named `userActions` exposes reducers for authentication, user data, loading, errors, and password-update success. |

`App.jsx` dispatches `currentUser` on startup and clears recorded errors; account pages and the header use the same Redux state. Actions use the credentialed [`utils/`](../../utils/README.md) client.

Parent: [`store/`](../README.md).
