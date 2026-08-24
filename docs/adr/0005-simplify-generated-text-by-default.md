# Simplify generated text by default

New Managed Text Objects will apply GeoGebra's `Simplify(Text)` to the complete evaluated concatenation by default, producing conventional signs and coefficients such as `-x` instead of `+ -1x`. Sign Simplification is deliberately whole-text and not LaTeX-aware—it can rewrite literal content including `\text{C++}` and `\text{--}`—so each object has a nearby opt-out control, adopted objects start with it disabled, and v1 provides no misleading inline protection syntax.
