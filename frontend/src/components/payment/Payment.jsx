import React, { useState } from "react";
import "../../css/Payment.css";
import {
  initiateCheckoutSession,
  verifyPayment,
} from "../../store/Payment/payment-action";
import {
  selectPaymentDetails,
  selectPaymentStatus,
  paymentActions,
} from "../../store/Payment/payment-slice";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";

// Safely inject the official Razorpay Checkout SDK
const loadRazorpayScript = () => {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

const Payment = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { propertyId } = useParams();
  const [processing, setProcessing] = useState(false);

  const { user } = useSelector((state) => state.user);
  const {
    checkinDate,
    checkoutDate,
    totalPrice,
    propertyName,
    guests,
    nights,
  } = useSelector(selectPaymentDetails);

  const { loading, error } = useSelector(selectPaymentStatus);

  const handleBooking = async () => {
    if (processing || loading) return;

    setProcessing(true);
    try {
      const isScriptLoaded = await loadRazorpayScript();
      if (!isScriptLoaded) {
        toast.error("Failed to load Razorpay payment gateway. Please check your internet connection.");
        setProcessing(false);
        return;
      }

      const orderData = await dispatch(
        initiateCheckoutSession({
          propertyId,
          fromDate: checkinDate,
          toDate: checkoutDate,
          guests,
        })
      );

      if (!orderData || !orderData.orderId) {
        toast.error("Unable to generate payment order. Please try again.");
        setProcessing(false);
        return;
      }

      // Configure Razorpay Standard Checkout options
      const options = {
        key: orderData.keyId,
        amount: orderData.amount, // amount in paise
        currency: orderData.currency || "INR",
        name: "HomelyHub",
        description: `Booking for ${propertyName || "HomelyHub Rental"}`,
        order_id: orderData.orderId,
        handler: async function (response) {
          try {
            await dispatch(
              verifyPayment({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              })
            );
            toast.success("🎉 Payment Successful! Booking Confirmed!");
            dispatch(paymentActions.resetPayment());
            setTimeout(() => navigate("/user/mybookings"), 1200);
          } catch (err) {
            toast.error(err.message || "Payment verification failed.");
          } finally {
            setProcessing(false);
          }
        },
        prefill: {
          name: user?.name || "",
          email: user?.email || "",
          contact: user?.phoneNumber || "",
        },
        notes: {
          propertyId,
          nights,
        },
        theme: {
          color: "#0e8b53",
        },
        modal: {
          ondismiss: function () {
            toast("Payment checkout cancelled.");
            setProcessing(false);
          },
        },
      };

      const razorpayInstance = new window.Razorpay(options);
      razorpayInstance.on("payment.failed", function (response) {
        toast.error(response.error?.description || "Payment failed at gateway.");
        setProcessing(false);
      });

      razorpayInstance.open();
    } catch (err) {
      toast.error(err.message || "Payment initiation failed.");
      setProcessing(false);
    }
  };

  return (
    <div className="payment-container">
      <div className="payment-header">
        <h1>Complete Your Booking</h1>
        <p>{propertyName}</p>
      </div>

      <div className="payment-content">
        <div className="booking-summary-card">
          <h3>Booking Details</h3>
          <div className="detail-row">
            <span>Check-in:</span>
            <span>{checkinDate}</span>
          </div>
          <div className="detail-row">
            <span>Check-out:</span>
            <span>{checkoutDate}</span>
          </div>
          <div className="detail-row">
            <span>Guests:</span>
            <span>{guests}</span>
          </div>
          <div className="detail-row">
            <span>Nights:</span>
            <span>{nights}</span>
          </div>
          <div className="detail-row total-row">
            <strong>Total Amount:</strong>
            <strong>₹{totalPrice}</strong>
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="payment-action">
          <button
            onClick={handleBooking}
            disabled={loading || processing}
            className="book-now-btn"
          >
            {loading || processing ? (
              "Processing..."
            ) : (
              `Proceed to Payment ₹${totalPrice}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Payment;
