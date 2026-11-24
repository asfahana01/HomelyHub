# `components/home/`

Shared site shell and property-discovery UI. `Main` renders `Header`, the nested route outlet, and `Footer`; the listing flow connects search/filter state and property results.

| File | Responsibility / key exports |
| --- | --- |
| [`Main.jsx`](Main.jsx) | Default-exported shared layout with header, route outlet, and footer. |
| [`Header.jsx`](Header.jsx) | Default-exported navigation/header; connects account state and site navigation. |
| [`Footer.jsx`](Footer.jsx) | Default-exported footer. |
| [`PropertyList.jsx`](PropertyList.jsx) | Default-exported property results view; reads listing state and dispatches listing fetches. |
| [`Search.jsx`](Search.jsx) | Default-exported date/location search controls. |
| [`Filter.jsx`](Filter.jsx) | Default-exported listing filter controls. |
| [`FilterModal.jsx`](FilterModal.jsx) | Default-exported filter modal and range inputs. |

Listing state and requests are implemented in
[`store/Property/`](../../store/Property/README.md). The search interface
supports property discovery by destination, guest count, and date range.
Property filters support price range, property type, room type, and amenities.
Search and filter criteria are passed to the listing API to retrieve matching
properties.

Styling is primarily [`css/Home.css`](../../css/README.md); the header also
imports `AiTripPlanner.css`.

Parent: [`components/`](../README.md).
