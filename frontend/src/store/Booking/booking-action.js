import { axiosInstance } from "../../utils/axios";
import {
  setBookingDetails,
  setBookingPolicy,
  setBookings,
  updateBooking,
} from "./booking-slice";

//fetch booking details
export const fetchBookingDetails = (bookingId) => async (dispatch) => {
  try {
    const response = await axiosInstance.get(
      `/v1/rent/user/booking/${bookingId}`
    );
    dispatch(setBookingDetails(response.data.data));
    if (response.data.data.cancellationPolicy) {
      dispatch(setBookingPolicy(response.data.data.cancellationPolicy));
    }
  } catch (error) {
    console.error("Error fetching booking details", error);
  }
};

// fetch user bookings

export const fetchUserBookings = () => async (dispatch) => {
  try {
    const response = await axiosInstance.get("/v1/rent/user/booking");
    dispatch(setBookings(response.data.data.bookings));
    if (response.data.data.cancellationPolicy) {
      dispatch(setBookingPolicy(response.data.data.cancellationPolicy));
    }
  } catch (error) {
    console.error("Error fetching bookings", error);
  }
};

export const cancelBooking = (bookingId) => async (dispatch) => {
  const response = await axiosInstance.post(
    `/v1/rent/user/booking/${bookingId}/cancel`,
    {}
  );
  dispatch(updateBooking(response.data.data.booking));
  return response.data.data;
};