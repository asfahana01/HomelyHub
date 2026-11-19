// managing booking

// store all bookings
// store individual booking details
// track the API loading status
//Add  new bookings when a booking is created
//updating the booking data when we recv it from the backend


import {createSlice} from "@reduxjs/toolkit";

const initialState ={
    bookings:[],
    bookingDetails:{},
    loading:false,
    cancellationPolicy: { cutoffHours: 24, refundPercentage: 100 },
}

const bookingSlice = createSlice({
    name:"booking",
    initialState,
    reducers:{
        setBookingRequest(state){
            state.loading=true;
        },
        setBookingPolicy(state, action) {
            state.cancellationPolicy = action.payload;
        },
        //stores the bookings recvd from the api
        setBookings(state,action){
         state.bookings= action.payload;
         state.loading=false
        },
        addBooking:(state,action)=>{
          state.bookings.push(action.payload);
        },
        setBookingDetails:(state,action)=>{
            state.bookingDetails = action.payload.bookings;
        },
        updateBooking(state, action) {
            const booking = action.payload;
            state.bookings = state.bookings.map((item) =>
                item._id === booking._id ? booking : item
            );
            if (state.bookingDetails?._id === booking._id) {
                state.bookingDetails = booking;
            }
        },
    }
})

export const {
    setBookings,
    addBooking,
    setBookingDetails,
    setBookingPolicy,
    updateBooking,
} = bookingSlice.actions;
export default bookingSlice;