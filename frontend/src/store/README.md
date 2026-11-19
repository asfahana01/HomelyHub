# `store/`

Redux Toolkit configuration and feature slices/actions. The store is installed by [`main.jsx`](../main.jsx) and its reducers are consumed through React Redux hooks.

| File | Responsibility / key export |
| --- | --- |
| [`store.js`](store.js) | Configures and default-exports the Redux store with `properties`, `propertydetails`, `user`, `booking`, `accomodation`, and `payment` reducers. |

## Feature state

- [`Accomodation/`](Accomodation/README.md) — host accommodation list and create requests.
- [`Booking/`](Booking/README.md) — booking history/details and cancellation.
- [`Payment/`](Payment/README.md) — checkout order and verification state.
- [`Property/`](Property/README.md) — property search/listing state.
- [`PropertyDetails/`](PropertyDetails/README.md) — selected listing detail state.
- [`User/`](User/README.md) — authentication, profile, and password actions.

These features use the shared [`utils/axios.js`](../utils/README.md) client. Static examples in [`data/`](../data/README.md) are not configured as reducers.

Parent: [`src/`](../README.md).
