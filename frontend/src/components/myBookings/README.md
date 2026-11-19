# `components/myBookings/`

Booking history and detail pages, including the customer cancellation flow.

| File | Responsibility / key exports |
| --- | --- |
| [`MyBookings.jsx`](MyBookings.jsx) | Default-exported booking list; dispatches the user's booking fetch action and displays booking rows. |
| [`BookingDetails.jsx`](BookingDetails.jsx) | Default-exported booking detail view; dispatches the booking-detail fetch and displays the selected booking. Its source retains TODO comments beside that fetch path. |
| [`BookingCancellationControls.jsx`](BookingCancellationControls.jsx) | Default-exported cancellation confirmation and status controls; dispatches `cancelBooking`, uses policy state, and displays toast feedback. |

Requests and booking state live in [`store/Booking/`](../../store/Booking/README.md). Related styles are [`MyBookings.css`](../../css/README.md), [`BookingDetails.css`](../../css/README.md), and [`BookingCancellation.css`](../../css/README.md).

Parent: [`components/`](../README.md).
