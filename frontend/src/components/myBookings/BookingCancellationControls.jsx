import { useState } from "react";
import { createPortal } from "react-dom";
import { useDispatch } from "react-redux";
import toast from "react-hot-toast";

import {
  cancelBooking,
  fetchUserBookings,
} from "../../store/Booking/booking-action";

import "../../css/BookingCancellation.css";

const BookingCancellationControls = ({
  booking,
  cancellationPolicy,
  onCancelled,
}) => {
  const dispatch = useDispatch();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const cutoffHours = Number(cancellationPolicy?.cutoffHours ?? 24);

  const eligible =
    booking?.paid &&
    booking.paymentStatus === "paid" &&
    !["refund_pending", "cancelled"].includes(
      booking.cancellationStatus
    ) &&
    new Date(booking.fromDate).getTime() - Date.now() >=
      cutoffHours * 60 * 60 * 1000;

  const handleCancel = async () => {
    setLoading(true);

    try {
      await dispatch(cancelBooking(booking._id));
      await dispatch(fetchUserBookings());
      await onCancelled?.();

      toast.success(
        "Cancellation accepted. Your refund is being processed."
      );

      setDialogOpen(false);
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          "Unable to cancel this booking. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  if (!booking?.paid) return null;

  return (
    <div
      className="booking-cancellation"
      onClick={(event) => event.stopPropagation()}
    >
      {booking.cancellationStatus === "cancelled" ? (
        <p className="booking-status booking-status-cancelled">
          Booking cancelled · Refund processed
        </p>
      ) : booking.paymentStatus === "refund_pending" ? (
        <p className="booking-status booking-status-pending">
          {booking.cancellationStatus === "refund_pending"
            ? "Cancellation requested · Refund pending"
            : "Refund pending"}
        </p>
      ) : booking.paymentStatus === "refund_processed" ? (
        <p className="booking-status booking-status-cancelled">
          Refund processed
        </p>
      ) : (
        <>
          {booking.paymentStatus === "paid" && (
            <p className="booking-policy">
              Full refund for cancellations made at least{" "}
              {cutoffHours} hours before check-in.
            </p>
          )}

          {eligible && (
            <button
              type="button"
              className="booking-cancel-button"
              onClick={() => setDialogOpen(true)}
            >
              Cancel booking
            </button>
          )}
        </>
      )}

      {/* Cancellation confirmation modal */}
      {dialogOpen &&
        createPortal(
          <div
            className="booking-cancel-backdrop"
            onClick={(event) => {
              if (
                event.target === event.currentTarget &&
                !loading
              ) {
                setDialogOpen(false);
              }
            }}
          >
            <section
              className="booking-cancel-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="booking-cancel-title"
            >
              <h2 id="booking-cancel-title">
                Cancel this booking?
              </h2>

              <p>
                This booking is eligible for a full refund of ₹
                {booking.price}. The refund will be sent to the
                original payment method and may take time to appear.
              </p>

              <p>
                The booking dates will be released once the
                cancellation request is accepted.
              </p>

              <div className="booking-cancel-actions">
                <button
                  type="button"
                  className="booking-cancel-secondary"
                  disabled={loading}
                  onClick={() => setDialogOpen(false)}
                >
                  Keep booking
                </button>

                <button
                  type="button"
                  className="booking-cancel-button"
                  disabled={loading}
                  onClick={handleCancel}
                >
                  {loading
                    ? "Processing..."
                    : "Confirm cancellation"}
                </button>
              </div>
            </section>
          </div>,
          document.body
        )}
    </div>
  );
};

export default BookingCancellationControls;
