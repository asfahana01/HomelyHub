# `store/PropertyDetails/`

| File | Responsibility / key exports |
| --- | --- |
| [`propertyDetails-action.js`](propertyDetails-action.js) | Exports `getPropertyDetails(id)`; requests `/v1/rent/listing/:id` and dispatches the result or error. |
| [`propertyDetails-slice.js`](propertyDetails-slice.js) | Default-exports the detail slice and named `propertDetailsAction`; stores one property's details, loading, and error state. |

Consumed by the property detail page; requests use the shared [`utils/`](../../utils/README.md) client.

Parent: [`store/`](../README.md).
