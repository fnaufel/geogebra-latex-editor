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

export type InspectedMetadata =
  | { kind: "current" | "older"; envelope: MetadataEnvelope }
  | { kind: "newer" | "foreign" | "malformed" };

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && keys.every((key) => actual.includes(key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validDocument(value: unknown, older = false): boolean {
  if (!isRecord(value)) return false;
  const keys = older
    ? ["targetLabel", "source", "compiledFingerprint"]
    : ["targetLabel", "source", "simplify", "compiledFingerprint"];
  return (
    exactKeys(value, keys) &&
    typeof value.targetLabel === "string" &&
    typeof value.source === "string" &&
    (older || typeof value.simplify === "boolean") &&
    typeof value.compiledFingerprint === "string"
  );
}

function parseJsonBinary(binary: string): unknown {
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function decodeJson(value: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1)
    throw new Error("Invalid base64url.");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const canonical = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  if (canonical !== value) throw new Error("Noncanonical base64url.");
  return parseJsonBinary(binary);
}

function isNewerEnvelope(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.application === "geogebra-latex-editor" &&
    ((typeof value.schemaVersion === "number" && value.schemaVersion > 1) ||
      (typeof value.languageVersion === "number" && value.languageVersion > 1))
  );
}

export function inspectMetadata(value: string): InspectedMetadata {
  let parsed: unknown;
  try {
    parsed = decodeJson(value);
  } catch {
    // Future app versions may use a different base64 convention. Recognize
    // their marker and version so older clients never attempt a write.
    if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
      try {
        const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
        if (isNewerEnvelope(parseJsonBinary(binary))) return { kind: "newer" };
      } catch {
        // Unreadable content remains malformed.
      }
    }
    return { kind: "malformed" };
  }
  if (!isRecord(parsed)) return { kind: "malformed" };
  if (parsed.application !== "geogebra-latex-editor")
    return { kind: "foreign" };
  if (isNewerEnvelope(parsed)) return { kind: "newer" };
  if (!isRecord(parsed.documents)) return { kind: "malformed" };
  if (
    parsed.schemaVersion === 1 &&
    parsed.languageVersion === 1 &&
    exactKeys(parsed, [
      "application",
      "schemaVersion",
      "languageVersion",
      "documents",
    ]) &&
    Object.values(parsed.documents).every((document) => validDocument(document))
  )
    return { kind: "current", envelope: parsed as unknown as MetadataEnvelope };
  // The only recognized predecessor had no source-language version or
  // simplification setting. Its source is interpreted as v1 literal/dynamic
  // source, with simplification disabled to avoid changing visible text.
  if (
    parsed.schemaVersion === 0 &&
    !Object.hasOwn(parsed, "languageVersion") &&
    exactKeys(parsed, ["application", "schemaVersion", "documents"]) &&
    Object.values(parsed.documents).every((document) =>
      validDocument(document, true),
    )
  ) {
    const envelope = emptyMetadata();
    for (const [id, document] of Object.entries(parsed.documents))
      envelope.documents[id] = {
        ...(document as Omit<ManagedDocument, "simplify">),
        simplify: false,
      };
    return { kind: "older", envelope };
  }
  return { kind: "malformed" };
}

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
      Object.entries(envelope.documents)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, document]) => [
          id,
          {
            targetLabel: document.targetLabel,
            source: document.source,
            simplify: document.simplify,
            compiledFingerprint: document.compiledFingerprint,
          },
        ]),
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
  const inspected = inspectMetadata(value);
  return inspected.kind === "current" ? inspected.envelope : null;
}
