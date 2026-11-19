# `src/`

Application source. [`main.jsx`](main.jsx) mounts the app with the Redux provider; [`App.jsx`](App.jsx) initializes the current user, configures routes, and renders global toasts.

## Direct files

| File | Responsibility / exports |
| --- | --- |
| [`App.jsx`](App.jsx) | Default-exported `App`; route tree, current-user dispatch, stale user-error clearing, and global `Toaster`. |
| [`main.jsx`](main.jsx) | Creates the React root, wraps `App` in `StrictMode` and Redux `Provider`, and loads global CSS. |
| [`App.css`](App.css) | App-level stylesheet. |
| [`index.css`](index.css) | Base/global stylesheet. |

## Source directories

- [`components/`](components/README.md) — route pages and reusable UI.
- [`store/`](store/README.md) — Redux store, feature slices, and async API actions.
- [`utils/`](utils/README.md) — shared Axios client and response interceptor.
- [`ai/`](ai/README.md) — API helpers for AI description generation and trip planning.
- [`css/`](css/README.md) — feature and component stylesheets.
- [`data/`](data/README.md) — static sample data exports.
- [`assets/`](assets/README.md) — source-importable static assets.

`App.jsx` defines routes; `components/home/Main.jsx` supplies the shared header, outlet, and footer layout. Cross-feature calls flow through Redux actions or the shared Axios client where present. Static sample data is defined in `data/staticData.js`; this directory does not itself wire those values into the Redux store.

Parent: [frontend README](../README.md).
