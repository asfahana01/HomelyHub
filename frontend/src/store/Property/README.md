# `store/Property/`

| File | Responsibility / key exports |
| --- | --- |
| [`property-action.js`](property-action.js) | Exports `getAllProperties`; reads current `searchParams` from Redux and GETs `/v1/rent/listing` with them. |
| [`property-slice.js`](property-slice.js) | Default-exports the property slice; `propertyAction` exposes reducers for result data, filters, loading, and errors. |

The home listing and filter UI use this state; HTTP calls share [`utils/`](../../utils/README.md).

Parent: [`store/`](../README.md).
