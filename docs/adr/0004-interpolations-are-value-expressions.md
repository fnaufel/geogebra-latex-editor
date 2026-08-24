# Restrict interpolations to Value Expressions

GeoGebra Interpolations accept English-language Value Expressions, not assignments, construction actions, deletions, or commands that produce multiple objects. This keeps applying a Managed Text Object free of unrelated construction side effects while retaining expressions and text-producing commands such as `FractionText`.

## Consequences

V1 accepts object labels, operators, and a curated catalog of tested single-result commands. Unknown, action, assignment, and known multi-output commands are rejected rather than evaluated speculatively in the live construction. An Undefined Value Expression is allowed with a warning, while an Unresolved Interpolation is an error. Rename propagation changes only tokens proven to be global object references; it never guesses across quoted text, locally bound variables, or other ambiguous syntax.
