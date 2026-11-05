export interface ManagedDocument {
  targetLabel: string;
  source: string;
  simplify: boolean;
  compiledFingerprint: string;
}

export interface MetadataEnvelope {
  application: "geogebra-latex-editor";
  schemaVersion: 1;
  languageVersion: 1;
  documents: Record<string, ManagedDocument>;
}

export const METADATA_PREFIX = "gglatexEditorMetadata";
export const METADATA_LABEL = "gglatexEditorMetadataV1";

export function emptyMetadata(): MetadataEnvelope {
  return {
    application: "geogebra-latex-editor",
    schemaVersion: 1,
    languageVersion: 1,
    documents: {},
  };
}

export function encodeMetadata(envelope: MetadataEnvelope): string {
  const ordered: MetadataEnvelope = {
    application: envelope.application,
    schemaVersion: envelope.schemaVersion,
    languageVersion: envelope.languageVersion,
    documents: Object.fromEntries(
      Object.entries(envelope.documents).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    ),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(ordered));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodeMetadata(value: string): MetadataEnvelope | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (
      record.application !== "geogebra-latex-editor" ||
      record.schemaVersion !== 1 ||
      record.languageVersion !== 1 ||
      !record.documents ||
      typeof record.documents !== "object" ||
      Array.isArray(record.documents)
    )
      return null;
    for (const document of Object.values(record.documents)) {
      if (!document || typeof document !== "object") return null;
      const entry = document as Record<string, unknown>;
      if (
        typeof entry.targetLabel !== "string" ||
        typeof entry.source !== "string" ||
        typeof entry.simplify !== "boolean" ||
        typeof entry.compiledFingerprint !== "string"
      )
        return null;
    }
    return parsed as MetadataEnvelope;
  } catch {
    return null;
  }
}
