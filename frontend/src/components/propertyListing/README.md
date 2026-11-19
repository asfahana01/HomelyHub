# `components/propertyListing/`

Property detail presentation and the form for choosing dates/guests before checkout.

| File | Responsibility / key exports |
| --- | --- |
| [`PropertyListing.jsx`](PropertyListing.jsx) | Default-exported property detail page; loads details and composes property sections and booking form. |
| [`PaymentForm.jsx`](PaymentForm.jsx) | Default-exported reservation form; stores payment details and navigates to `/payment/:propertyId`. |
| [`PropertyImg.jsx`](PropertyImg.jsx) | Default-exported property image display. |
| [`PropertyAmenities.jsx`](PropertyAmenities.jsx) | Default-exported amenities display. |
| [`MapComponent.jsx`](MapComponent.jsx) | Default-exported map view; uses Leaflet/React Leaflet and a geocoding `fetch` request. |
| [`PropertyMapInfo.jsx`](PropertyMapInfo.jsx) | Default-exported map information content (`PropertMapInfo` is the component's declared identifier). |
| [`Modal.jsx`](Modal.jsx) | Default-exported modal component. |

Property data comes from [`store/PropertyDetails/`](../../store/PropertyDetails/README.md); payment details are stored in [`store/Payment/`](../../store/Payment/README.md). Styles are in [`css/PropertyListing.css`](../../css/README.md) and [`css/Modal.css`](../../css/README.md).

Parent: [`components/`](../README.md).
