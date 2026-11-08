# User guide

LaTeX Text Editor for GeoGebra is an unofficial, non-commercial desktop web application. It edits GeoGebra constructions in your browser. The left pane is GeoGebra Classic; the right pane edits one pinned **Editing Target**. The app needs a network connection for its static files and the pinned GeoGebra applet. It does not offer offline operation or mobile authoring.

## Start and save a construction

Use **New construction** to clear the workspace, **Open .ggb** to choose a file from your computer, and **Download .ggb** to save the current construction. Opening a file stages it before replacing your workspace; a failed open leaves the current work in place. The default download name is `construction.ggb` for a new construction or `lesson-edited.ggb` after opening `lesson.ggb`; the Download dialog lets you change it. The `.ggb` remains usable in ordinary GeoGebra.

The toolbar shows **Dirty Construction** when GeoGebra or the editor has changed the construction since the last open or download. **Draft Source** means editor changes have not been applied to a text object. These are separate states. New, Open, navigation, and reload warn when work would be lost. A browser download is treated as complete when it is dispatched; the browser cannot tell the app whether you later moved or deleted the file.

Try [the example construction](../examples/motivating-formula.ggb). It contains `a`, `b`, and a Managed Text Object demonstrating `FractionText(b/a)`. Open it and change `a` or `b` in GeoGebra to see the rendered text update.

## Choose and edit text

**New Managed Text** creates a text object near the visible canvas center and opens its empty Authoring Source. GeoGebra chooses its label. To edit another text, select exactly one text object in GeoGebra and choose **Edit selected text**. Ordinary selection never changes the pinned Editing Target. Selecting a number, point, or several objects leaves the editor target alone.

A **Managed Text Object** has recoverable Authoring Source embedded in the construction. Its right pane shows the source, the current Applied Source state, and any Draft Source. An **Unmanaged Text Object** has no recoverable Authoring Source: its current rendered LaTeX is shown read-only. **Adopt text** asks for explicit confirmation, then makes that rendering a literal snapshot. Original dynamic dependencies cannot be reconstructed. Adoption preserves the text object's supported presentation settings and starts Sign Simplification off.

If a Managed Text Object is deleted, its source may appear as **Orphaned Source**. Restore it as a new Managed Text Object or discard it explicitly. When a draft's Applied Source changes through GeoGebra history, the editor marks a **Diverged Draft** and offers **Reapply Draft** and **Discard Draft**. An incompatible or corrupt metadata notice leaves the construction usable while preventing an unsafe metadata overwrite. An Apply error retains the draft and reports the recovery action; a failed rollback offers **Restore failed Apply draft**.

## Authoring syntax

Write a LaTeX body with `@expression@` for each **GeoGebra Interpolation**. For example, `@a@ x^2 + @b@ x = @a@ \\left( x^2 + @FractionText(b/a)@ x \\right)` uses two construction values and a safe text-producing command. Use `@@` in a Literal Segment for one printed `@`, such as `contact@@example.com`. An unmatched `@` or an empty interpolation is an error with a source range. Interpolations can span lines, but cannot contain `@` even inside a quoted GeoGebra string.

Source line endings are normalized to spaces in the Compiled Definition. Type an explicit LaTeX `\\` when you want a rendered line break. LaTeX backslashes and ASCII quotation marks are preserved in the text passed to GeoGebra. The editor offers a curated set of GeoGebra-supported LaTeX commands outside interpolations and live object labels, constants, pure functions, and the [safe Value Expression catalog](../README.md#value-expression-catalog-language-version-1) inside them. This is not a full TeX distribution.

Only one value-producing expression is allowed inside each interpolation. Assignments, actions, unknown commands, and commands that can create multiple objects are rejected before GeoGebra evaluation. A missing object label is an error. An existing object whose mathematical value is currently undefined produces a warning and can still be applied. The app does not evaluate partial editor expressions while you type.

**Clean signs and 1x coefficients** is the per-object **Sign Simplification** control. It is on for new Managed Text Objects and off for Adoption. It asks GeoGebra to rewrite the complete text, including literal LaTeX: `\text{C++}` can become content equivalent to `\text{C + }`, and `\text{--}` can become content equivalent to `\text{ + }`. Turn it off for text where those rewrites matter, then Apply the change. The **Advanced** disclosure shows the one-line Compiled Definition and offers a copy action.

## Apply, history, and download choices

Diagnostics refresh after a brief pause. Use their labeled buttons to move to the relevant source range. **Apply** is available when the current draft has no errors; it validates again immediately and commits the text definition and embedded Applied Source together. Press `Ctrl+Enter` on Windows or Linux, or `Command+Enter` on macOS, while the editor is focused to Apply. The app returns focus to the editor after a successful Apply.

CodeMirror undo and redo change Draft Source only. GeoGebra's toolbar undo and redo change the applied construction. A dirty draft is preserved when construction history changes underneath it, and you must resolve a Diverged Draft deliberately. **Insert Object** starts a one-shot mode: select exactly one GeoGebra object to insert its label as an interpolation at the cursor. A multiple selection inserts nothing; **Cancel insertion** or Escape exits the mode.

When Draft Sources exist, Download offers **Apply all valid drafts**, **Download applied construction only**, or **Cancel**. Invalid and divergent drafts are not embedded as Applied Source. If an attempted Apply fails, the download is canceled and your workspace remains available. A downloaded `.ggb` contains the last applied source for Managed Text Objects, not unapplied drafts.

## Local recovery and privacy

The browser stores Recovery Drafts and a construction snapshot locally for up to 30 days. **Local recovery** lists entries by age and workspace identity without exposing source in the list. Restore a snapshot and drafts only after reviewing the entry; nothing is automatically applied to GeoGebra. You can discard an entry or use **Clear local recovery data** to see and remove the local record count and byte size. Tabs with the same construction warn each other, but do not synchronize or merge drafts.

Construction files, Authoring Source, recovery content, and diagnostics stay in your browser. The application has no backend, account, analytics, telemetry, advertising, or third-party error reporting. Network requests load the application's static assets and GeoGebra's pinned bundle and resources. **Copy diagnostic report** and **Download diagnostic report** produce an allowlisted technical report with versions, browser family, phases, and sanitized codes; it excludes source, object labels and values, filenames, `.ggb` bytes, and recovery payloads. Share a construction or source separately only if you choose to.

## Accessibility and browser support

The surrounding toolbar, dialogs, editor actions, diagnostics, disclosures, and split control have keyboard controls and visible focus. Focus returns after dialogs, Apply, and successful Insert Object. Use the arrow keys on the split control to resize by two percentage points, or Home and End to jump to its limits. State messages use text and live announcements. Accessibility inside the embedded GeoGebra applet depends on GeoGebra and is outside this application's control.

Automated release checks target Chromium, Firefox, and Playwright WebKit. These results do not certify Chrome, Edge, Brave, Vivaldi, Firefox as a branded installation, or Safari on macOS. Branded browser support is **provisional and unverified** until the separate human certification checklist records a pass for each browser. Playwright WebKit is not a Safari pass. See the [release checklist](release-checklist.md) for the current evidence and manual procedure.

## Attribution and licenses

**Unofficial · Made with GeoGebra®**. This project's code is [MIT licensed](../LICENSE). GeoGebra code, assets, and trademarks are governed separately by the [GeoGebra license](https://www.geogebra.org/license) and [terms](https://www.geogebra.org/tos); they are not covered by this project's MIT license. Commercial deployment requires separate GeoGebra authorization.
