# LaTeX Text Editor for GeoGebra

An unofficial, local-first editor for authoring LaTeX text in GeoGebra constructions. The [accepted specification](docs/specs/0001-v0.1.0-geogebra-latex-editor.md) defines the release behavior; implementation is proceeding one issue at a time.

## Run locally

Use Node.js `26.13.0` and npm `12.2.2`. From the repository root, run `npm ci` and `npm run dev`. Open the local URL printed by Vite. The app loads GeoGebra Classic `5.4.920.0` from GeoGebra's CDN, so it needs a network connection.

Run `npx playwright install chromium` once before browser tests. `npm run check` runs formatting, linting, type checking, unit tests, the production build, and Chromium browser tests. Individual commands are `npm run typecheck`, `npm run test:unit`, `npm run test:e2e`, and `npm run build`. CI runs these checks on pull requests and deploys the static build from `master` to GitHub Pages only after they pass. Vite uses the `/geogebra-latex-editor/` base path for Pages.

## Scope and access

The shell keeps construction and editor data in the browser and includes no analytics, account integration, or application server. The editor remains read-only until the Editing Target workflow is implemented. GeoGebra's own menus, file controls, and sign-in controls are hidden; its construction toolbar and Undo/Redo controls remain visible. The surrounding shell supports keyboard resizing and visible focus. Accessibility inside the embedded GeoGebra applet depends on GeoGebra and is outside this project's control.

## Embedded Authoring Source metadata

Authoring Source is stored in a hidden, auxiliary, fixed, non-selectable GeoGebra text object, encoded as deterministic UTF-8 JSON and unpadded base64url. The preferred label is `gglatexEditorMetadataV1`; an occupied label is never overwritten, and the next free `gglatexEditorMetadata_<n>` label is used. Discovery requires a text object and an exact application marker and schema shape. Multiple valid carriers are treated as ambiguous. Unknown newer versions stay byte-for-byte unchanged and block metadata writes. Malformed or missing metadata leaves text objects usable as unmanaged objects and produces a diagnostic.

The recognized older format is schema version 0 with no `languageVersion` or `simplify` field. It migrates in memory to schema version 1 and defaults Sign Simplification to off. The original encoded bytes remain available through **Download original metadata**, backed by tab-local session storage across reloads, until a migrated `.ggb` download is dispatched. The carrier is the supported construction object; the application does not depend on extra `.ggb` archive entries.

The pinned GeoGebra `5.4.920.0` Chromium contract test in `tests/e2e/metadata-capacity.spec.ts` exports a carrier containing more than 1 MiB of decoded JSON and 100 Managed Text records, then opens the `.ggb` data in a fresh applet and verifies the exact encoded value and auxiliary properties. Run it with `npx playwright test tests/e2e/metadata-capacity.spec.ts` after installing Chromium.

## Value Expression catalog (language version 1)

Inside `@...@`, completion offers current construction labels, the safe English GeoGebra commands below, pure functions, and constants. Every nested operation is checked before Apply; unknown commands, actions, assignments, and multi-output commands are rejected. A missing label is an error. An existing undefined object produces a warning and can still be applied. The editor does not evaluate raw expressions to validate them.

| Command           | Supported arguments                                                |
| ----------------- | ------------------------------------------------------------------ |
| `FormulaText`     | value; value, boolean; value, boolean, boolean                     |
| `FractionText`    | value; value, boolean                                              |
| `SurdText`        | value; number, list                                                |
| `ScientificText`  | number; number, number                                             |
| `TableText`       | one to three lists, or one or two lists followed by alignment text |
| `VerticalText`    | value                                                              |
| `Ordinal`         | value                                                              |
| `UnicodeToLetter` | value                                                              |
| `Name`            | value                                                              |
| `Text`            | value; value, boolean (positioned forms are excluded)              |
| `Simplify`        | value                                                              |
| `If`              | boolean, value; boolean, value, value                              |

The pure built-in functions are `abs`, `sgn`, `sqrt`, `exp`, `log`, `ln`, `ld`, `lg`, `cos`, `sin`, `tan`, `acos`, `arcos`, `arccos`, `asin`, `arcsin`, `atan`, `arctan`, `atan2`, `cosh`, `sinh`, `tanh`, `acosh`, `arcosh`, `arccosh`, `asinh`, `arcsinh`, `atanh`, `arctanh`, `erf`, `floor`, `ceil`, `round`, `conjugate`, `arg`, `gamma`, `gammaRegularized`, `beta`, `betaRegularized`, `sec`, `csc`, `cosec`, `cot`, `sech`, `csch`, and `coth`. All take one argument except `atan2` and `gammaRegularized` (two), `beta` (two or three), and `betaRegularized` (three); `gamma`, `log`, and `round` accept one or two. `arcos` is accepted in Authoring Source and compiled as `acos` for the pinned GeoGebra runtime. `random` is excluded.

Completion also offers `x`, `y`, `z`, `true`, `false`, `π`, `ℯ`, `ί`, `i`, and `e` inside interpolations. Outside interpolations, the supported LaTeX completion list is `\frac`, `\sqrt`, `\text`, `\left`, `\right`, `\alpha`, `\beta`, `\gamma`, `\pi`, `\sum`, `\int`, `\cdot`, `\times`, `\begin`, `\end`, `\overline`, `\vec`, and `\mathbf`. This is a curated GeoGebra-oriented subset rather than a full TeX catalog.

## Licensing

Application code is licensed under [MIT](LICENSE). GeoGebra code, assets, and trademarks are separately governed by the [GeoGebra license](https://www.geogebra.org/license) and [terms](https://www.geogebra.org/tos). This is an unofficial non-commercial application. Commercial deployment requires separate GeoGebra authorization.
