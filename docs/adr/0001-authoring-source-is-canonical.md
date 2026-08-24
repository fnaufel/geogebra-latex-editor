# Treat Authoring Source as canonical

For each Managed Text Object, the annotated LaTeX Authoring Source is authoritative and its Compiled Definition is derived output. Generated GeoGebra definitions cannot in general be converted losslessly back into the original source, so requiring round-trip conversion would make editing unreliable and constrain future source-language changes.

## Consequences

The application must preserve Authoring Source when a construction is saved and distinguish Managed Text Objects from arbitrary GeoGebra text objects.
