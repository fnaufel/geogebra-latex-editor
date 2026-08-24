# GeoGebra LaTeX Authoring

This context describes authoring dynamic LaTeX text whose rendered form lives in a GeoGebra construction.

## Language

**Authoring Source**:
The canonical, editable LaTeX body for one Managed Text Object, including any GeoGebra Interpolations.
_Avoid_: Editor document, input text, original command

**Managed Text Object**:
A GeoGebra text object for which the application preserves Authoring Source and can produce a Compiled Definition.
_Avoid_: App text, editable text

**Unmanaged Text Object**:
A GeoGebra text object for which no Authoring Source is available.
_Avoid_: Existing text, foreign text, unsupported text

**Adoption**:
The explicit conversion of an Unmanaged Text Object into a Managed Text Object using its current rendered LaTeX as a Literal Segment; prior dynamic dependencies are not recovered.
_Avoid_: Import, automatic conversion

**GeoGebra Interpolation**:
A segment of Authoring Source delimited by paired `@` characters and containing one GeoGebra expression whose result contributes dynamic content to a Managed Text Object.
_Avoid_: Object reference, GeoGebra code, embedded value

**Value Expression**:
A side-effect-free GeoGebra expression that produces one value suitable for a GeoGebra Interpolation.
_Avoid_: Command, action, statement

**Literal Segment**:
A segment of Authoring Source interpreted as literal LaTeX rather than as a GeoGebra expression.
_Avoid_: Static part, plain text

**Compiled Definition**:
The derived GeoGebra expression generated from Authoring Source to define a Managed Text Object.
_Avoid_: Translation, generated source, output text

**Sign Simplification**:
An object-level policy that applies GeoGebra's whole-text simplification to clean sign sequences and unit coefficients in a Compiled Definition; it may also rewrite literal LaTeX or prose.
_Avoid_: LaTeX simplification, algebraic simplification, cleanup

**Draft Source**:
An unapplied revision of Authoring Source retained separately from the Managed Text Object's last applied state.
_Avoid_: Unsaved text, temporary source

**Diverged Draft**:
A Draft Source whose Applied Source changed through construction history or another external action after the draft was created.
_Avoid_: Conflict, stale text

**Recovery Draft**:
A locally retained Draft Source offered after an interrupted browser workspace is reopened; it is never applied automatically.
_Avoid_: Autosave, backup

**Applied Source**:
The most recent Authoring Source successfully committed together with its Compiled Definition.
_Avoid_: Saved text, current command

**Unresolved Interpolation**:
A GeoGebra Interpolation containing a reference to an object label that does not exist in the construction.
_Avoid_: Broken reference, missing value

**Undefined Value Expression**:
A syntactically valid Value Expression whose referenced objects exist but whose current mathematical value is undefined.
_Avoid_: Unresolved Interpolation, invalid expression

**Editing Target**:
The text object whose Authoring Source or adoption view is currently open in the editor; it remains pinned independently of GeoGebra's current selection.
_Avoid_: Selected text, active object, current object

**Insertion Mode**:
A one-shot interaction in which the next GeoGebra object selected by the user is inserted into the Editing Target as an object-label interpolation.
_Avoid_: Selection mode, reference mode

**Orphaned Source**:
Authoring Source retained after its Managed Text Object no longer exists in the construction.
_Avoid_: Deleted text, dangling metadata

**Dirty Construction**:
A construction whose current `.ggb` state differs from the file most recently opened or downloaded.
_Avoid_: Dirty draft, unsaved text
