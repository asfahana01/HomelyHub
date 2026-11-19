# `components/accomodation/`

Host-side accommodation browsing, editing/creation form composition, and listing removal.

| File | Responsibility / key exports |
| --- | --- |
| [`Accomodation.jsx`](Accomodation.jsx) | Default-exported accommodation page; composes the user's accommodation view. |
| [`MyAccomodation.jsx`](MyAccomodation.jsx) | Default-exported list view; reads accommodation state and deletes a listing through `axiosInstance`. |
| [`AccomodationForm.jsx`](AccomodationForm.jsx) | Default-exported create-listing form; uses the AI description helper and accommodation Redux actions. |
| [`AddressField.jsx`](AddressField.jsx) | Named `AddressField` form field. |
| [`AmenitiesField.jsx`](AmenitiesField.jsx) | Named `AmenitiesField` form field. |
| [`ImagesUploading.jsx`](ImagesUploading.jsx) | Default-exported image-upload form section. |

The form submits through [`store/Accomodation/Accomodation-action.js`](../../store/Accomodation/README.md); generated descriptions use [`aiDescription.js`](../../ai/README.md). The page stylesheet is [`css/Accomodation.css`](../../css/README.md).

Parent: [`components/`](../README.md).
