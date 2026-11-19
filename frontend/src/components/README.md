# `components/`

Route-level views and reusable React components. Most page modules default-export a component; [`AddressField.jsx`](accomodation/AddressField.jsx) and [`AmenitiesField.jsx`](accomodation/AmenitiesField.jsx) instead expose named form-field components.

## Direct files

| File | Responsibility / export |
| --- | --- |
| [`LoadingSpinner.jsx`](LoadingSpinner.jsx) | Default-exported loading indicator; imports `css/Spinner.css`. |
| [`NotFound.jsx`](NotFound.jsx) | Default-exported not-found view used by the wildcard route. |
| [`ProgressSteps.jsx`](ProgressSteps.jsx) | Default-exported progress indicator; imports `css/ProgressSteps.css`. |

## Feature directories

- [`accomodation/`](accomodation/README.md) — host listings and accommodation form.
- [`aiTripPlanner/`](aiTripPlanner/README.md) — trip-planning page.
- [`home/`](home/README.md) — shared site shell, search, filters, and property browsing.
- [`myBookings/`](myBookings/README.md) — booking list, details, and cancellation UI.
- [`payment/`](payment/README.md) — checkout page and payment interaction.
- [`propertyListing/`](propertyListing/README.md) — property details, maps, amenities, and reservation form.
- [`user/`](user/README.md) — account and password pages.

Parent: [`src/`](../README.md).
