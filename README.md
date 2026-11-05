# LaTeX Text Editor for GeoGebra

An unofficial, local-first editor for authoring LaTeX text in GeoGebra constructions. This repository currently contains the application shell: a pinned GeoGebra Classic applet, a CodeMirror editor area, and a resizable split. Text editing and `.ggb` file operations will arrive in later slices of the [accepted specification](docs/specs/0001-v0.1.0-geogebra-latex-editor.md).

## Run locally

Use Node.js `26.13.0` and npm `12.2.2`. From the repository root, run `npm ci` and `npm run dev`. Open the local URL printed by Vite. The app loads GeoGebra Classic `5.4.920.0` from GeoGebra's CDN, so it needs a network connection.

Run `npx playwright install chromium` once before browser tests. `npm run check` runs formatting, linting, type checking, unit tests, the production build, and Chromium browser tests. Individual commands are `npm run typecheck`, `npm run test:unit`, `npm run test:e2e`, and `npm run build`. CI runs these checks on pull requests and deploys the static build from `master` to GitHub Pages only after they pass. Vite uses the `/geogebra-latex-editor/` base path for Pages.

## Scope and access

The shell keeps construction and editor data in the browser and includes no analytics, account integration, or application server. The editor remains read-only until the Editing Target workflow is implemented. GeoGebra's own menus, file controls, and sign-in controls are hidden; its construction toolbar and Undo/Redo controls remain visible. The surrounding shell supports keyboard resizing and visible focus. Accessibility inside the embedded GeoGebra applet depends on GeoGebra and is outside this project's control.

## Licensing

Application code is licensed under [MIT](LICENSE). GeoGebra code, assets, and trademarks are separately governed by the [GeoGebra license](https://www.geogebra.org/license) and [terms](https://www.geogebra.org/tos). This is an unofficial non-commercial application. Commercial deployment requires separate GeoGebra authorization.
