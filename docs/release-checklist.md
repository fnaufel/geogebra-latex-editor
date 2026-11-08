# v0.1.0 release checklist

This checklist records the release candidate separately from human browser certification. The accepted [v0.1.0 specification](specs/0001-v0.1.0-geogebra-latex-editor.md) governs acceptance. The app version is `0.1.0`, metadata schema and source language are independently versioned as `1`, and the pinned GeoGebra Classic version is `5.4.920.0`.

## Automated gate

Use Node `26.13.0` and npm `12.2.2`. Run `npm ci`, `npx playwright install --with-deps chromium firefox webkit`, and `npm run check`. The check command runs formatting, lint, strict TypeScript, all unit tests, the production build, and Playwright across Chromium, Firefox, and WebKit. CI runs this gate for pull requests and `master`; the Pages deployment job runs only after the gate succeeds on a `master` push. Inspect the applet status in each browser to confirm it reports `5.4.920.0`.

The browser suite includes real applet contract tests for version, file round trip, metadata capacity, object events, presentation preservation, grouped Apply history, safe Value Expressions, and local recovery. Unit tests exercise the pure compiler, metadata, workspace, transaction and rollback, and sanitized diagnostics. `tests/e2e/release-accessibility.spec.ts` checks the surrounding keyboard path; embedded GeoGebra accessibility remains upstream-dependent.

| Spec journey                                           | Browser evidence                                       |
| ------------------------------------------------------ | ------------------------------------------------------ |
| 1. Create numbers and dynamic motivating formula       | `release-formula.spec.ts`                              |
| 2. Download and reopen exact source and simplification | `roundtrip.spec.ts`                                    |
| 3. Adopt, edit, Apply, undo, redo                      | `adoption.spec.ts`                                     |
| 4. Pin target and insert another object                | `selection.spec.ts`                                    |
| 5. Syntax, missing, undefined, and runtime diagnostics | `release-diagnostics.spec.ts`, `apply-history.spec.ts` |
| 6. Rename, delete, and restore source                  | `rename-orphan.spec.ts`                                |
| 7. Diverged Draft after construction undo              | `apply-history.spec.ts`                                |
| 8. Download choices with valid and invalid drafts      | `file-lifecycle.spec.ts`                               |
| 9. Interrupted work and Recovery Draft                 | `recovery.spec.ts`                                     |
| 10. Failed `.ggb` open leaves workspace intact         | `file-lifecycle.spec.ts`                               |
| 11. Corrupt and newer metadata without overwrite       | `release-metadata.spec.ts`, `adoption.spec.ts`         |
| 12. Keyboard, focus, and status announcements          | `release-accessibility.spec.ts`, `shell.spec.ts`       |

Before publishing, inspect the resulting `dist/` and run `npm run preview` at `/geogebra-latex-editor/`. Verify the static Content Security Policy in `index.html` against actual applet requests, and confirm there is no backend, analytics, telemetry, account flow, offline claim, or mobile-support claim. Check the [example `.ggb`](../examples/motivating-formula.ggb) opens in a fresh app session and in ordinary GeoGebra.

## Pages publication

Pages must be configured to deploy through GitHub Actions. A passing `master` push uploads `dist/` and triggers the deployment job. After publication, open the final repository subpath, confirm all assets load, confirm the applet reports `5.4.920.0`, and repeat the twelve journeys against the deployed candidate. Record the Pages deployment URL, workflow run URL, commit SHA, date, and any failures here before marking the release deployed.

| Evidence                 | Result             |
| ------------------------ | ------------------ |
| Pages URL                | Pending deployment |
| Passing workflow run     | Pending deployment |
| Deployed commit SHA      | Pending deployment |
| Deployed applet version  | Pending deployment |
| Twelve deployed journeys | Pending deployment |

## Manual branded browser certification

This is a separate human release step. Automated Chromium, Firefox, and WebKit runs do not prove that the current branded Chrome, Edge, Brave, Vivaldi, Firefox, or Safari on macOS passed. Keep browser support wording provisional until a tester records each result. On each browser, open the final Pages URL and the example `.ggb`; exercise New, Open, create, adopt, edit, completion, insert, diagnostics, Apply, undo, redo, rename, delete, Download, reopen, recovery, keyboard navigation, visible focus, and live status. Record browser and operating system versions, tester, date, result, and issue links for failures. Safari must be tested in Safari on macOS, not inferred from Playwright WebKit.

| Browser         | Version and OS | Tester and date | Result     |
| --------------- | -------------- | --------------- | ---------- |
| Chrome          | Pending        | Pending         | Unverified |
| Edge            | Pending        | Pending         | Unverified |
| Brave           | Pending        | Pending         | Unverified |
| Vivaldi         | Pending        | Pending         | Unverified |
| Firefox         | Pending        | Pending         | Unverified |
| Safari on macOS | Pending        | Pending         | Unverified |

## Licensing, privacy, and reporting

Confirm the visible **Unofficial · Made with GeoGebra®** notice and links to the project source, GeoGebra license, and terms. The repository's MIT license covers project-owned code only; GeoGebra code, assets, and trademarks retain their separate terms. Commercial use requires separate GeoGebra authorization. Confirm the [user guide](user-guide.md) covers syntax, the safe catalog, the `@@` literal, Managed and Unmanaged Text, Adoption, Sign Simplification risks, drafts, history, files, recovery, privacy, and provisional browser wording.

For a problem report, use **Copy diagnostic report** or **Download diagnostic report**. Inspect the JSON before sharing: it should contain only application and applet versions, browser family, stable phase and error codes, and a bounded event history. It must not contain Authoring Source, object labels or definitions, filenames, `.ggb` bytes, or recovery content. Share source or a construction only through a separate, deliberate action.
