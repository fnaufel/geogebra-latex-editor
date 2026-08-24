# Keep Recovery Drafts local

The application stores unapplied recovery data only in browser-local IndexedDB, separated by construction fingerprint and workspace identifier. Recovery Drafts are offered rather than applied automatically, tabs never synchronize edits silently, and recovery data is cleared after explicit application or discard; no construction or source content is uploaded for recovery.
