# `components/payment/`

| File | Responsibility / key exports |
| --- | --- |
| [`Payment.jsx`](Payment.jsx) | Default-exported checkout page. Loads Razorpay Checkout's hosted script, requests an order, opens the browser checkout, and sends the returned payment identifiers to backend verification. |

Order creation and verification are dispatched through [`store/Payment/`](../../store/Payment/README.md); checkout styles are in [`css/Payment.css`](../../css/README.md). The browser collects the gateway response, while the backend endpoint performs verification.

Parent: [`components/`](../README.md).
