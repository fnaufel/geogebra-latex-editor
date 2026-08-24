# Keep saved constructions self-contained

A downloaded `.ggb` must carry the Authoring Source for every Managed Text Object so that it remains fully editable on another supported browser or computer. Sidecar files and browser-local storage would make the authoring model dependent on files or state that users can easily separate from the GeoGebra construction.

## Consequences

The application must embed versioned authoring metadata in the `.ggb` while remaining compatible with GeoGebra itself.
