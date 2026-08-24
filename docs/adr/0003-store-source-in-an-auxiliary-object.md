# Store Authoring Source in an auxiliary object

The application will embed a UTF-8 base64url-encoded, versioned metadata envelope in one invisible, fixed, non-selectable, auxiliary GeoGebra text object. GeoGebra's public file APIs preserve supported construction objects but discard unknown custom archive entries during export, making an auxiliary object the least brittle supported carrier for a self-contained `.ggb`. A browser spike against the pinned applet confirmed exact export and reload of quotes, LaTeX backslashes, newlines, and Unicode.

## Consequences

Metadata discovery scans the ASCII-letter-leading `gglatexEditorMetadata` label prefix and accepts only objects whose decoded envelope carries the application marker and supported, independently versioned schema and source-language formats; collisions are never overwritten. Missing, corrupt, deleted, or unsupported metadata must degrade safely to Unmanaged Text Objects. Unknown newer formats are preserved without rewriting. When labels were changed outside the application, recovery may use the stored label and Compiled Definition fingerprint but may reattach only a single unambiguous match. Conservative recovery and realistic payload sizes require browser integration tests.
