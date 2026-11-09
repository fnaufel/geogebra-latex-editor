# v0.1.0 release checklist

This checklist records the release candidate separately from human browser certification. The accepted [v0.1.0 specification](specs/0001-v0.1.0-geogebra-latex-editor.md) governs acceptance. The app version is `0.1.0`, metadata schema and source language are independently versioned as `1`, and the pinned GeoGebra Classic version is `5.4.920.0`.

## Automated gate

Use Node `26.13.0` and npm `12.2.2`. Run `npm ci`, `npx playwright install --with-deps chromium firefox webkit`, and `npm run check` locally. The check command runs formatting, lint, strict TypeScript, all unit tests, the production build, and Playwright across Chromium, Firefox, and WebKit. Inspect the applet status in each browser to confirm it reports `5.4.920.0`. Record the local check result before publishing.

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

Configure Pages to deploy from the `gh-pages` branch at `/(root)`. After the local check passes, commit and push `master`, then run `npm run publish:pages`. That command rebuilds locally and pushes `dist/` plus `.nojekyll` to `gh-pages`. After publication, open the final repository subpath, confirm all assets load, confirm the applet reports `5.4.920.0`, and repeat the twelve journeys against the deployed candidate. Run the browser suite against Pages locally with `PLAYWRIGHT_BASE_URL=https://fnaufel.github.io/geogebra-latex-editor/ npm run test:e2e`. Record the Pages URL, source and publication commit SHAs, local check result, date, and any failures here before marking the release deployed.

| Evidence                 | Result                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Local check              | Passed 2026-11-09: 114 unit and 129 browser tests, plus formatting, lint, type checking, and build |
| Pages URL                | [Published site](https://fnaufel.github.io/geogebra-latex-editor/) returned HTTP 200 on 2026-11-09 |
| Source commit SHA        | `158f33f7c07ddbf8fc311ffb481fa59613e265f0`                                                         |
| Publication commit SHA   | `c2f65e9ef19e61896ca15afaf8954fbb88f42a43`                                                         |
| Deployed applet version  | `5.4.920.0` in a Chromium smoke check; no failed requests                                          |
| Twelve deployed journeys | Passed on 2026-11-09 as part of 129 browser tests against the published Pages URL                  |

## Manual branded browser certification

This is the separate human release step in [issue #15](https://github.com/fnaufel/geogebra-latex-editor/issues/15). Automated Chromium, Firefox, and WebKit results do not certify the named branded browsers. Run the same journey below in current Chrome, Edge, Brave, Vivaldi, Firefox, and Safari on macOS hardware. Record a pass only when every step succeeds in that browser; keep support wording provisional for any unverified browser. Playwright WebKit is not a Safari pass.

### Agreed smoke journey

Before each run, download the [example construction](../examples/motivating-formula.ggb) and create a local file named `invalid.ggb` containing plain text such as `not a GeoGebra file`. Use a fresh browser profile or clear this site's data so earlier Recovery Drafts cannot affect the result. Keep the downloaded test files until the journey is complete.

1. Open the [published editor](https://fnaufel.github.io/geogebra-latex-editor/). Confirm that the applet status says `GeoGebra ready (5.4.920.0).`, the construction toolbar and editor are visible, and no loading or compatibility error remains.
2. Choose **Open .ggb** and open the example construction. Confirm that a Managed Text Object becomes the Editing Target, its Authoring Source includes `@FractionText(b/a)@`, and the construction displays the rendered text.
3. Choose **New Managed Text**, enter `@a@ x^2 + @b@ x`, and choose **Apply**. Confirm that the new text appears in GeoGebra and the editor reports that Applied Source is current.
4. Place the cursor at the end of that Authoring Source, choose **Insert Object**, and select the object labeled `a` in GeoGebra. Confirm that `@a@` is inserted once, the editor regains focus, and **Apply** updates the text.
5. Use GeoGebra's toolbar **Undo** and **Redo**. Confirm that the text and its Applied Source move back and forward together, while the Editing Target remains usable.
6. Replace the source with `@missing@`. Confirm that a missing-reference diagnostic appears and **Apply** is disabled. Replace it with `@a@`, choose **Apply**, and confirm that the error clears and the text updates. This is the visible failure and retry check.
7. Choose **Download .ggb**, select **Download applied construction only**, and save the file. Confirm that the toolbar reports **Construction current** after the download is dispatched.
8. Open the published editor in a fresh tab, then open the downloaded `.ggb`. Confirm that the same text, exact Authoring Source from step 6, and **Clean signs and 1x coefficients** setting are recovered from the file. This is the source recovery check.
9. In that tab, choose **Open .ggb** and select `invalid.ggb`. Confirm that `FILE_OPERATION_FAILED` is visible and the current construction and Authoring Source remain available. Retry by opening the valid downloaded `.ggb` and confirm that it opens successfully.
10. Make an unapplied Draft Source such as `Recovery check @a@`, wait until the editor reports unapplied changes, and reload the tab. Open **Local recovery**, restore the offered snapshot and draft, and confirm that the Draft Source returns without being applied automatically.
11. Use Tab to reach the file controls and the pane splitter, move the splitter with an arrow key, and confirm visible focus and readable status text throughout the journey. Record any focus trap, missing announcement, or applet limitation.

Record the browser and operating system versions, tester and date, overall result, and the first failing step with an issue link or limitation. A browser is supported only after this journey passes in that branded browser.

| Browser         | Version and OS | Tester and date | Result     | Failure or limitation |
| --------------- | -------------- | --------------- | ---------- | --------------------- |
| Chrome          | Pending        | Pending         | Unverified | Pending               |
| Edge            | Pending        | Pending         | Unverified | Pending               |
| Brave           | Pending        | Pending         | Unverified | Pending               |
| Vivaldi         | Pending        | Pending         | Unverified | Pending               |
| Firefox         | Pending        | Pending         | Unverified | Pending               |
| Safari on macOS | Pending        | Pending         | Unverified | Pending               |

## Licensing, privacy, and reporting

Confirm the visible **Unofficial · Made with GeoGebra®** notice and links to the project source, GeoGebra license, and terms. The repository's MIT license covers project-owned code only; GeoGebra code, assets, and trademarks retain their separate terms. Commercial use requires separate GeoGebra authorization. Confirm the [user guide](user-guide.md) covers syntax, the safe catalog, the `@@` literal, Managed and Unmanaged Text, Adoption, Sign Simplification risks, drafts, history, files, recovery, privacy, and provisional browser wording.

For a problem report, use **Copy diagnostic report** or **Download diagnostic report**. Inspect the JSON before sharing: it should contain only application and applet versions, browser family, stable phase and error codes, and a bounded event history. It must not contain Authoring Source, object labels or definitions, filenames, `.ggb` bytes, or recovery content. Share source or a construction only through a separate, deliberate action.
