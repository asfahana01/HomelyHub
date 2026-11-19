# 🏠 HomelyHub — Modern Rental Property Platform

HomelyHub is a full-stack MERN (MongoDB, Express.js, React.js, Node.js) property rental platform featuring Razorpay payment integration, Groq-powered AI travel planning and description generation, and production-grade security architecture.

---

## 🚀 Key Features

- **Property Browsing & Search**: Search rental accommodations by city, guest capacity, and date availability with price filters.
- **Razorpay Standard Checkout**: Authentic payment flow with server-side price calculation, timing-safe cryptographic HMAC SHA-256 signature verification, and idempotent webhook handling.
- **Role-Based Access Control (RBAC)**: Secure admin-only property management (create, update, safe archive) and guest-only booking permissions.
- **IDOR Protection**: All booking details and user actions enforce server-side resource ownership checks.
- **AI-Powered Features (Groq API)**:
  - **Trip Genie**: AI trip planner generating day-by-day itineraries matching budget, party size, and destination.
  - **AI Property Description**: Generates natural descriptions for new property listings.
- **Production-Grade Security**:
  - Helmet HTTP security headers
  - Strict CORS allowlisting with credentials
  - Express rate limiters for auth, payment, and AI endpoints
  - NoSQL injection sanitization
  - Safe property deletion policy that archives listings with active guest reservations

---

## 🔐 How to Login as an Administrator

HomelyHub follows strict Role-Based Access Control (RBAC). For security reasons, public registration does **not** allow self-assignment of the `"admin"` role; all new signups are automatically assigned the `"user"` role.

To log in as an administrator:

### Step 1: Sign up a regular account
Open the app (`http://localhost:5173/signup`) and register with your email and password.

### Step 2: Promote your account to Admin via the CLI script
Open a terminal in the `backend` directory and run the secure promotion script with your registered email:

```bash
cd backend
node src/scripts/promoteAdmin.js your-email@example.com
```

Output:
```text
Connected to MongoDB
[AUDIT] Successfully promoted "your-email@example.com" (ID: 673...) to "admin".
```

### Step 3: Log in to the application
1. Go to `http://localhost:5173/login`.
2. Log in using your email and password (if already logged in, log out and log back in to refresh your JWT session token).
3. Once logged in as an admin:
   - Navigate to **My Account** (`/profile`).
   - The navigation bar displays the **Manage Accommodations** tab (`/accomodation`).
   - Inside `/accomodation`, you have access to **+ Add new property** (`/accomodationform`).
   - You can also safely **Archive** listed properties directly from the dashboard.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, Redux Toolkit, React Router 6, Axios, Leaflet (Maps), React Hot Toast
- **Backend**: Node.js, Express 5, MongoDB, Mongoose 9, JWT (Cookie-based), bcrypt, Helmet, Express Rate Limit
- **Payments**: Razorpay Standard Checkout (Node.js SDK & Checkout.js)
- **AI**: Groq Cloud API SDK (`openai/gpt-oss-120b`)
- **Media**: ImageKit Node.js SDK

---

## ⚙️ Environment Configuration

Create a `.env` file in the `backend/` directory based on [backend/.env.example](backend/.env.example):

```env
# Server Configuration
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
ORIGIN_ACCESS_URL=http://localhost:5173

# Database
MONGO_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/homelyhub?retryWrites=true&w=majority

# JWT Authentication
JWT_SECRET=your_super_secret_jwt_key_at_least_32_characters_long
JWT_EXPIRES_IN=7d
JWT_COOKIE_EXPIRES_IN=7

# Email (Mailtrap / SMTP)
MAILTRAP_SMTP_HOST=sandbox.smtp.mailtrap.io
MAILTRAP_SMTP_PORT=2525
MAILTRAP_SMTP_USER=your_mailtrap_user
MAILTRAP_SMTP_PASS=your_mailtrap_password

# ImageKit
IMAGE_PUBLICKEY=your_imagekit_public_key
IMAGE_PRIVATEKEY=your_imagekit_private_key
IMAGEKIT_URLENDPOINT=https://ik.imagekit.io/your_endpoint

# AI (Groq SDK)
GROQ_API_KEY=gsk_your_groq_api_key

# Razorpay Payment Gateway
RAZORPAY_KEY_ID=rzp_test_your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_razorpay_webhook_secret
REFUND_WORKER_INTERVAL_MS=60000
REFUND_MAX_ATTEMPTS=10
BOOKING_CANCELLATION_CUTOFF_HOURS=24
```

---

## 🏃 Running the Application

### 1. Start the Backend Server

```bash
cd backend
npm install
npm run dev
```
The backend starts on `http://localhost:3000`.

### 2. Start the Frontend Development Server

```bash
cd frontend
npm install
npm run dev
```
The frontend starts on `http://localhost:5173` with API calls automatically proxied to the backend.

---

## 🧪 Security & Automated Testing

HomelyHub includes an automated security test suite covering JWT authentication, IDOR prevention, timing-safe Razorpay signature verification, NoSQL injection rejection, and booking overlap detection.

Run the test suite:

```bash
cd backend
npm test
```

Build the frontend for production:

```bash
cd frontend
npm run build
```

---

## 🛡️ Security Implementation Highlights

- **Server-Side Price Authority**: Booking amounts are calculated exclusively on the server (`nights * property.price * 100` paise). Client-provided amounts or status flags are never trusted.
- **Timing-Safe HMAC Verification**: Razorpay payment and webhook signatures are validated using `crypto.timingSafeEqual`.
- **Atomic Booking Concurrency**: Prevents double-booking via atomic MongoDB queries (`$not: { $elemMatch: { ... } }`).
- **Safe Archiving Policy**: Properties with active reservations cannot be deleted; they are archived to preserve guest itineraries and historical accounting records.

## Booking cancellations and refunds

Customers can request cancellation from **My Bookings** or a booking's details page. The authenticated endpoint is `POST /api/v1/rent/user/booking/:bookingId/cancel`. The backend verifies booking ownership and the captured Razorpay payment, then atomically changes the booking to `refund_pending`, creates one refund task per payment, and releases the property dates. The full refund is calculated from the stored booking amount; clients cannot choose the amount.

The default policy is a full refund when cancellation is requested at least 24 hours before check-in. Configure `BOOKING_CANCELLATION_CUTOFF_HOURS` in the backend environment to change that cutoff. Refund processing requires MongoDB transactions (a replica set or compatible cluster). The worker uses Razorpay's `X-Refund-Idempotency` header for safe retries and only marks a refund processed after a subsequent Razorpay refund fetch or a verified `refund.processed` webhook.

Configure the Razorpay webhook URL as `https://<your-api-host>/api/v1/rent/user/booking/webhook`, set its secret to the same value as `RAZORPAY_WEBHOOK_SECRET`, and subscribe to `payment.captured`, `payment.failed`, `refund.processed`, and `refund.failed`. The endpoint must be publicly reachable by Razorpay; keep the API key secret and webhook secret server-side.

### Test-mode refund check

1. Use Razorpay **Test Mode** credentials and a MongoDB replica-set test database. Set `BOOKING_CANCELLATION_CUTOFF_HOURS` and `RAZORPAY_WEBHOOK_SECRET`.
2. Configure the Test Mode webhook URL and the four events above. Use Razorpay's documented test payment details to complete a booking whose check-in is outside the cancellation cutoff.
3. Open **My Bookings**, choose **Cancel booking**, and confirm. The API should return `202` with `refund.status: "pending"`; do not treat that response as proof that the refund completed.
4. Wait for the refund worker and/or `refund.processed` webhook. Confirm the Razorpay Test Mode payment shows a refund and the booking changes to `refund_processed` (and `cancelled` for a customer cancellation).
5. To check retry handling, use a test payment/refund that the gateway reports as failed, then confirm the task remains retryable and no duplicate refund is created. Never use live credentials for this test.
