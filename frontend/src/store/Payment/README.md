# `store/Payment/`

| File | Responsibility / key exports |
| --- | --- |
| [`payment-action.js`](payment-action.js) | Exports `initiateCheckoutSession` (POST `/v1/rent/user/booking/create-order`) and `verifyPayment` (POST `/v1/rent/user/booking/verify-payment`); returns response data and records errors. |
| [`payment-slice.js`](payment-slice.js) | Default-exports the payment slice; exports `paymentActions`, `setPaymentDetails`, `selectPaymentDetails`, and `selectPaymentStatus`. Stores checkout details, order data, loading state, and errors. |

[`components/payment/Payment.jsx`](../../components/payment/README.md) drives this flow with Razorpay Checkout; API requests use the shared [`utils/`](../../utils/README.md) client.

Parent: [`store/`](../README.md).
