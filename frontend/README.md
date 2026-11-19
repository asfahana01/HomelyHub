# HomelyHub frontend

The frontend is a React 18 single-page app built with Vite. It uses React Router for navigation, Redux Toolkit and React Redux for shared application state, and a credentialed Axios client for the backend API.

## Run and build

From this directory:

```bash
npm install
npm run dev
npm run build
npm run preview
npm run lint
```

The dev server proxies `/api` requests to `http://localhost:3000` (see [`vite.config.js`](vite.config.js)). The Axios client uses `/api` as its base URL. Configure the backend and any environment-specific settings to match your local deployment. The package defines no frontend test script.

The dependency set also includes Ant Design, TanStack React Form, GSAP, Leaflet/React Leaflet, date pickers, toast notifications, and Lucide icons. Browser-global Bootstrap, Google Fonts/Material Icons, and Font Awesome styles are linked from [`index.html`](index.html).

## Application structure

- [`src/`](src/README.md) contains the app entry, routes, UI, state, API utilities, and styles.
- [`public/`](public/README.md) contains files served directly at the site root.
- [`package.json`](package.json) defines scripts and dependencies.
- [`package-lock.json`](package-lock.json) locks the npm dependency tree.
- [`index.html`](index.html) supplies the root element and external fonts/icons/stylesheets.
- [`vite.config.js`](vite.config.js) configures React and the local API proxy.
- [`eslint.config.js`](eslint.config.js) defines the flat ESLint configuration.

The root project documentation is [../README.md](../README.md).

## Routes

Routes are declared in [`src/App.jsx`](src/App.jsx) beneath the shared `Main` layout. `/editprofile`, `/user/updatepassword`, `/user/mybookings`, `/user/mybookings/:bookingId`, and `/payment/:propertyId` redirect to `/login` when there is no user in Redux state. Other routes, including profile and accommodation routes, are rendered without that route-level check.

| Path | Page |
| --- | --- |
| `/` | Property browsing (`PropertyList`) |
| `/propertylist/:id` | Property details and booking form |
| `/login`, `/signup` | Authentication |
| `/profile`, `/editprofile` | Profile and profile editing |
| `/ai-trip-planner` | AI trip planner |
| `/accomodation`, `/accomodationform` | Host accommodations and listing form |
| `/user/forgotPassword`, `/user/resetPassword/:token` | Password recovery |
| `/user/updatepassword` | Authenticated password update |
| `/user/mybookings`, `/user/mybookings/:bookingId` | Authenticated bookings |
| `/payment/:propertyId` | Authenticated checkout |
| `*` | Not-found page |

## Backend and integrations

[`src/utils/axios.js`](src/utils/README.md) configures credentialed `/api` requests and retries a failed authenticated request after a shared refresh-token request. Redux action modules call `/v1/rent/...` endpoints through that client for authentication, listings, accommodations, bookings, and checkout. The property-description and trip-planning helpers also use it. Checkout loads Razorpay's hosted Checkout SDK in the browser; order creation and payment verification are backend API calls, not direct client-side payment verification.

### Main frontend-to-backend flows

| Feature | Frontend request flow |
| --- | --- |
| Account | `store/User/user-action.js` calls `/v1/rent/user/...` for signup, login, current-user lookup, profile/password updates, password recovery, and logout. The Axios client includes credentials and handles eligible 401 refreshes. |
| Property discovery | `store/Property/property-action.js` GETs `/v1/rent/listing` with Redux search parameters; `PropertyDetails/propertyDetails-action.js` requests `/v1/rent/listing/:id`. The host listing view also DELETEs `/v1/rent/listing/:id`. |
| Hosting | Accommodation actions POST `/v1/rent/user/newAccommodation` and GET `/v1/rent/user/myAccommodation`. `ai/aiDescription.js` POSTs description inputs to `/v1/rent/user/generateDescription`. |
| Trips | `ai/tripPlanner.js` POSTs trip inputs to `/v1/rent/trip`. |
| Booking | Booking actions GET `/v1/rent/user/booking` and `/v1/rent/user/booking/:bookingId`; cancellation POSTs to `/v1/rent/user/booking/:bookingId/cancel`. |
| Payment | Payment actions POST to `/v1/rent/user/booking/create-order`, then `/v1/rent/user/booking/verify-payment` with the Razorpay order/payment/signature response. The client does not calculate the payable amount as authoritative or verify the signature itself. |

See the [source overview](src/README.md) and its directory READMEs for action names and module details.
