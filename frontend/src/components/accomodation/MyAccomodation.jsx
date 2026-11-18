import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { axiosInstance } from "../../utils/axios";
import { getAllAccomodation } from "../../store/Accomodation/Accomodation-action";
import toast from "react-hot-toast";

const MyAccomodation = ({ accomodation }) => {
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.user);
  const isAdmin = user && user.role === "admin";

  const handleArchiveProperty = async (propertyId, propertyName) => {
    const confirmed = window.confirm(
      `Are you sure you want to archive "${propertyName}"? Active bookings will be preserved, and the property will be hidden from public listings.`
    );
    if (!confirmed) return;

    try {
      const response = await axiosInstance.delete(`/v1/rent/listing/${propertyId}`);
      toast.success(response.data?.message || "Property listing archived successfully.");
      dispatch(getAllAccomodation());
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to archive property");
    }
  };

  return (
    <div className="main-container">
      {accomodation.map((item) => (
        <div className="myaccomodation-container row" key={item._id}>
          <div className="myaccomodation-image-container col-lg-3 col-md-3">
            <img
              className="myaccomodation-img"
              src={item.images?.[0]?.url || "/assets/placeholder.jpg"}
              alt={item.propertyName}
            />
          </div>
          <div className="myaccomodation-information col-lg-9 col-md-9">
            <h6 className="myaccomodation-hotel-name">{item.propertyName}</h6>
            <div className="stay-information">
              <span className="info">
                <span className="material-symbols-outlined icon">
                  calendar_month
                </span>
                Check In Time: {item.checkInTime}
              </span>
              <span className="material-symbols-outlined icon">
                arrow_forward
              </span>
              <span className="info">
                <span className="material-symbols-outlined icon">
                  calendar_month
                </span>
                Check Out Time: {item.checkOutTime}
              </span>
            </div>
            <p className="myaccomodation-city">City: {item.address?.city}</p>
            <p className="myaccomodation-guest">
              Max no of guest: {item.maximumGuest}
            </p>
            <h5 className="myaccomodation-price">
              <span className="material-symbols-outlined">payments</span> Price
              per night: &#8377; {item.price}
            </h5>
            {isAdmin && (
              <div className="mt-3">
                <button
                  className="btn btn-sm btn-outline-danger"
                  onClick={() => handleArchiveProperty(item._id, item.propertyName)}
                >
                  <span className="material-symbols-outlined align-middle me-1">
                    archive
                  </span>
                  Archive Property
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default MyAccomodation;
