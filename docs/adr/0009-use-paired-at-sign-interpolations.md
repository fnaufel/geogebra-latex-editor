# Use paired at signs for interpolation

Authoring Source delimits each GeoGebra Interpolation as `@expression@`, while `@@` in a Literal Segment produces one literal at sign. Interpolations may span source lines, whose breaks compile as spaces, but cannot contain an at sign; unmatched delimiters and empty or whitespace-only expressions are errors with source ranges.
