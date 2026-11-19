# `store/Booking/`

| File | Responsibility / key exports |
| --- | --- |
| [`booking-action.js`](booking-action.js) | Exports `fetchBookingDetails`, `fetchUserBookings`, and `cancelBooking`; calls the user booking endpoints for detail/list and `POST /v1/rent/user/booking/:bookingId/cancel`. |
| [`booking-slice.js`](booking-slice.js) | Default-exports the booking slice; named actions `setBookings`, `addBooking`, `setBookingDetails`, `setBookingPolicy`, and `updateBooking` update booking and cancellation-policy state. |

The booking pages and cancellation controls dispatch these actions. HTTP calls use the shared client in [`utils/`](../../utils/README.md).

Parent: [`store/`](../README.md).
