# Separate draft and construction history

CodeMirror undo and redo operate only on Draft Source, while GeoGebra undo and redo operate on applied construction states. A construction-history change never overwrites a dirty draft; if its Applied Source changes underneath it, the draft becomes a Diverged Draft that the user must reapply or discard explicitly.
