# Apply source and definition together

Applying an edit commits the target's Compiled Definition and its Applied Source metadata as one verified construction change and one GeoGebra undo point. Because GeoGebra does not guarantee transactional rollback across several commands, the application snapshots both objects, verifies postconditions before recording history, and restores the snapshot if either update fails.
