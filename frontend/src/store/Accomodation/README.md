# `store/Accomodation/`

| File | Responsibility / key exports |
| --- | --- |
| [`Accomodation-action.js`](Accomodation-action.js) | Exports `createAccomodation` (POST `/v1/rent/user/newAccommodation`) and `getAllAccomodation` (GET `/v1/rent/user/myAccommodation`) async thunks. |
| [`Accomodation-slice.js`](Accomodation-slice.js) | Default-exports the accommodation slice; named `accomodationActions` exposes request, success, and error reducers for its list/loading/error state. |

The actions call the shared credentialed client in [`utils/`](../../utils/README.md); the accommodation form/list consume these operations.

Parent: [`store/`](../README.md).
