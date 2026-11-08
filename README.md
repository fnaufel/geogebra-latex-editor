# LaTeX Text Editor for GeoGebra

An unofficial, local-first editor for authoring LaTeX text in GeoGebra constructions. Start with the [user guide](docs/user-guide.md), try the [example construction](examples/motivating-formula.ggb), and use the [release checklist](docs/release-checklist.md) for validation. The [accepted specification](docs/specs/0001-v0.1.0-geogebra-latex-editor.md) defines the release behavior.

## Run locally

Use Node.js `26.13.0` and npm `12.2.2`. From the repository root, run `npm ci` and `npm run dev`. Open the local URL printed by Vite. The app loads GeoGebra Classic `5.4.920.0` from GeoGebra's CDN, so it needs a network connection.

Run `npx playwright install chromium firefox webkit` once before browser tests. `npm run check` runs formatting, linting, type checking, unit tests, the production build, and browser tests in Chromium, Firefox, and Playwright WebKit. For routine Chromium-only feedback use `npm run test:e2e -- --project=chromium`. Individual commands are `npm run typecheck`, `npm run test:unit`, `npm run test:e2e`, and `npm run build`. CI runs these checks on pull requests and deploys the static build from `master` to GitHub Pages only after they pass. Vite uses the `/geogebra-latex-editor/` base path for Pages. The deployment remains pending until this release candidate is pushed and Pages is enabled for the repository.

## Scope and access

Construction and editor data stay in the browser; the app has no analytics, account integration, or application server. GeoGebra's own menus, file controls, and sign-in controls are hidden; its construction toolbar and Undo/Redo controls remain visible. The surrounding interface supports keyboard resizing, visible focus, and announced status changes. Accessibility inside the embedded GeoGebra applet depends on GeoGebra and is outside this project's control. Branded browser support remains provisional until recorded human checks pass; Playwright WebKit does not certify Safari.

## Embedded Authoring Source metadata

Authoring Source is stored in a hidden, auxiliary, fixed, non-selectable GeoGebra text object, encoded as deterministic UTF-8 JSON and unpadded base64url. The preferred label is `gglatexEditorMetadataV1`; an occupied label is never overwritten, and the next free `gglatexEditorMetadata_<n>` label is used. Discovery requires a text object and an exact application marker and schema shape. Multiple valid carriers are treated as ambiguous. Unknown newer versions stay byte-for-byte unchanged and block metadata writes. Malformed or missing metadata leaves text objects usable as unmanaged objects and produces a diagnostic.

The recognized older format is schema version 0 with no `languageVersion` or `simplify` field. It migrates in memory to schema version 1 and defaults Sign Simplification to off. The original encoded bytes remain available through **Download original metadata**, backed by tab-local session storage across reloads, until a migrated `.ggb` download is dispatched. The carrier is the supported construction object; the application does not depend on extra `.ggb` archive entries.

The pinned GeoGebra `5.4.920.0` Chromium contract test in `tests/e2e/metadata-capacity.spec.ts` exports a carrier containing more than 1 MiB of decoded JSON and 100 Managed Text records, then opens the `.ggb` data in a fresh applet and verifies the exact encoded value and auxiliary properties. Run it with `npx playwright test tests/e2e/metadata-capacity.spec.ts` after installing Chromium.

## Local recovery

Unapplied Draft Sources and construction snapshots are retained in this browser's IndexedDB for up to 30 days. A tab-local session-storage journal covers a rapid reload before an IndexedDB write finishes; it is cleared with the recovery data. After a reload, **Local recovery** lists available entries by age, workspace identifier, construction fingerprint, and snapshot size without showing Authoring Source. Restoring an entry explicitly opens its local construction snapshot and shows its Draft Sources for review; it does not Apply them to GeoGebra. The editor reports whether the recovered draft matches or diverges from the snapshot's Applied Source. If a target cannot be identified safely, its source remains Orphaned Source and can be restored explicitly as a new Managed Text Object. Each entry can be discarded, or **Clear local recovery data** previews and reports the number of records and bytes removed. Recovery data is never uploaded, included in telemetry, or silently merged across tabs. Tabs with the same construction fingerprint warn each other through a browser-local presence channel while remaining independent. Downloaded `.ggb` files carry Applied Source, not unapplied Recovery Drafts.

## Private failure reports

Use **Copy diagnostic report** or **Download diagnostic report** to share technical details after a failure. The JSON contains only the application version, browser family, pinned GeoGebra version, and the latest 20 known phase and error-code pairs. It never includes Authoring Source, object labels or definitions, filenames, `.ggb` contents, or recovery payloads. Compiler messages stay in the editor for correction but do not enter the report. Share source or a construction separately only when you choose to. The application has no telemetry endpoint and sends no diagnostic report automatically.

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
