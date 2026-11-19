# `public/`

Static files here are served directly from the website root rather than imported by the JavaScript module graph.

| Direct file or directory | Responsibility |
| --- | --- |
| [`vite.svg`](vite.svg) | Vite starter SVG asset. |
| [`assets/`](assets/README.md) | App logo, profile image, and property/sample imagery referenced by root-relative URLs. |
| [`readme/`](readme/README.md) | Application screenshot image. |

`MyAccomodation.jsx` references `/assets/placeholder.jpg` as an image fallback, but no `placeholder.jpg` file is present in this directory's assets.

Parent: [frontend](../README.md).
