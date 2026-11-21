import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Vite rewrites Leaflet's default icon URLs, so point the marker at the
// bundled images explicitly.
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const properNames = {
  himachalpradesh: "Himachal Pradesh",
  tamilnadu: "Tamil Nadu",
  westbengal: "West Bengal",
  madhyapradesh: "Madhya Pradesh",
  andhrapradesh: "Andhra Pradesh",
  uttarpradesh: "Uttar Pradesh",
  alleppey: "Alappuzha",
  pondicherry: "Puducherry",
};

const MapComponent = ({ address }) => {
  const city = properNames[address.city] || address.city;
  const state = properNames[address.state] || address.state;
  const place = `${address.area}, ${city}, ${state}`;

  // Use saved coordinates when the property has them; otherwise geocode.
  const lat = Number(address.latitude);
  const lng = Number(address.longitude);
  const savedCoordinates =
    address.latitude != null &&
    address.longitude != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
      ? [lat, lng]
      : null;

  const [geocoded, setGeocoded] = useState([]);
  const [loading, setLoading] = useState(!savedCoordinates);
  const [error, setError] = useState(null);
  const coordinates = savedCoordinates || geocoded;

  useEffect(() => {
    if (savedCoordinates) return undefined;
    let isMounted = true;

    const searchTexts = [
      `${address.area}, ${city}, ${state}, India`,
      `${address.area}, ${city}, India`,
      `${city}, ${state}, India`,
    ];

    const fetchCoordinates = async () => {
      try {
        for (const text of searchTexts) {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(
              text
            )}`
          );
          const data = await response.json();

          if (!isMounted) return;

          if (data.length > 0) {
            setGeocoded([Number(data[0].lat), Number(data[0].lon)]);
            setLoading(false);
            return;
          }
        }

        if (isMounted) {
          setGeocoded([]);
          setLoading(false);
        }
      } catch (error) {
        if (isMounted) {
          console.error("Error fetching geocoding data:", error);
          setError("Map is not available right now");
          setLoading(false);
        }
      }
    };
    fetchCoordinates();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address.area, city, state, address.latitude, address.longitude]);

  return (
    <div>
      {loading && <p>Loading map...</p>}
      {error && <p>{error}</p>}
      {!loading && !error && coordinates.length === 0 && (
        <p>Map is not available for this location</p>
      )}
      {coordinates.length > 0 && (
        <MapContainer
          key={coordinates.join(",")}
          center={coordinates}
          zoom={14}
          style={{ height: "320px", width: "100%", borderRadius: "12px" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker position={coordinates}>
            <Popup>{place}</Popup>
          </Marker>
        </MapContainer>
      )}
    </div>
  );
};
export default MapComponent;