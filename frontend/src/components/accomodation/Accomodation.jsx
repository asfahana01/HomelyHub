import React, { useEffect } from "react";
import "../../css/Accomodation.css";
import ProgressSteps from "../ProgressSteps";
import MyAccomodation from "./MyAccomodation";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { getAllAccomodation } from "../../store/Accomodation/Accomodation-action";
import LoadingSpinner from "../LoadingSpinner";

const Accomodation = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { user } = useSelector((state) => state.user);
  const { accomodation, loading } = useSelector((state) => state.accomodation);
  const isAdmin = user && user.role === "admin";

  useEffect(() => {
    if (user && !isAdmin) {
      navigate("/profile");
      return;
    }
    if (isAdmin) {
      dispatch(getAllAccomodation());
    }
  }, [dispatch, user, isAdmin, navigate]);

  if (!isAdmin) {
    return (
      <>
        <ProgressSteps />
        <div className="accom-container text-center mt-5">
          <p>Access Restricted: Property management is reserved for administrators.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <ProgressSteps accomodation />
      <div className="accom-container">
        <Link to="/accomodationform">
          <button className="add-new-place">+ Add new property</button>
        </Link>
        {loading && <LoadingSpinner />}
        {accomodation.length === 0 && !loading && (
          <p>No accommodations available</p>
        )}
        {accomodation.length > 0 && !loading && (
          <MyAccomodation accomodation={accomodation} loading={loading} />
        )}
      </div>
    </>
  );
};

export default Accomodation;
