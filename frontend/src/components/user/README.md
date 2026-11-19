# `components/user/`

Account, profile, and password-management pages.

| File | Responsibility / key exports |
| --- | --- |
| [`Login.jsx`](Login.jsx) | Default-exported login form; dispatches login action. |
| [`Signup.jsx`](Signup.jsx) | Default-exported registration form; dispatches signup action. |
| [`Profile.jsx`](Profile.jsx) | Default-exported profile view. |
| [`EditProfile.jsx`](EditProfile.jsx) | Default-exported profile editor; dispatches user update action. |
| [`UpdatePassword.jsx`](UpdatePassword.jsx) | Default-exported authenticated password-change form. |
| [`ForgetPassword.jsx`](ForgetPassword.jsx) | Default-exported password-reset request form. |
| [`ResetPassword.jsx`](ResetPassword.jsx) | Default-exported token-based password reset form. |

Async account operations and auth state are provided by [`store/User/`](../../store/User/README.md); the shared Axios client handles credentials/refresh behavior in [`utils/`](../../utils/README.md). Styling is in [`css/Login.css`](../../css/README.md), [`css/Profile.css`](../../css/README.md), and [`css/ForgetPassword.css`](../../css/README.md).

Parent: [`components/`](../README.md).
