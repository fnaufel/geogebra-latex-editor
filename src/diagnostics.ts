import packageInfo from "../package.json";
import { ApplyFailure, GEOGEBRA_VERSION } from "./geogebra";

export type FailurePhase =
  | "compiler"
  | "applet"
  | "transaction"
  | "metadata"
  | "file"
  | "recovery"
  | "compatibility";

export interface FailureNotice {
  phase: FailurePhase;
  code: string;
  message: string;
}

const applyCodes = new Set([
  "APPLY_TARGET_MISSING",
  "APPLY_SNAPSHOT_UNAVAILABLE",
  "APPLY_GEOGEBRA_REJECTED",
  "APPLY_POSTCONDITION_FAILED",
  "APPLY_METADATA_FAILED",
  "APPLY_MUTATION_FAILED",
  "APPLY_COMPILER_REJECTED",
  "APPLY_ROLLED_BACK",
  "APPLY_ROLLBACK_FAILED",
]);
const compilerCodes = new Set([
  "unclosed-string",
  "invalid-number",
  "invalid-character",
  "missing-operator",
  "empty-expression",
  "incomplete-expression",
  "empty-argument",
  "assignment",
  "missing-operand",
  "invalid-operator",
  "unsafe-command",
  "unknown-command",
  "undefined-value",
  "unresolved-reference",
  "unexpected-comma",
  "unbalanced-delimiter",
  "unsupported-overload",
  "unmatched-interpolation",
  "empty-interpolation",
]);
const fixedCodes = new Set([
  "APPLET_LOAD_FAILED",
  "APPLET_VERSION_MISMATCH",
  "METADATA_INVALID",
  "METADATA_NEWER",
  "METADATA_AMBIGUOUS",
  "METADATA_MALFORMED",
  "METADATA_MISSING",
  "METADATA_SYNC_FAILED",
  "FILE_OPERATION_FAILED",
  "RECOVERY_OPERATION_FAILED",
  "RECOVERY_SNAPSHOT_MISMATCH",
  "COMPATIBILITY_ERROR",
  "COMPILER_REJECTED",
  "TRANSACTION_FAILED",
]);
export class DiagnosticHistory {
  private readonly history: { phase: FailurePhase; code: string }[] = [];

  record(phase: FailurePhase, code: string): void {
    if (
      !applyCodes.has(code) &&
      !compilerCodes.has(code) &&
      !fixedCodes.has(code)
    )
      return;
    const last = this.history.at(-1);
    if (last?.phase === phase && last.code === code) return;
    this.history.push({ phase, code });
    if (this.history.length > 20) this.history.shift();
  }

  report(userAgent: string): string {
    const browser = /Edg\//.test(userAgent)
      ? "Edge"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chromium"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Other";
    return JSON.stringify(
      {
        applicationVersion: packageInfo.version,
        browserFamily: browser,
        geogebraVersion: GEOGEBRA_VERSION,
        events: this.history.slice(),
      },
      null,
      2,
    );
  }
}

export function failureNotice(
  error: unknown,
  phase: FailurePhase,
): FailureNotice {
  if (
    error instanceof Error &&
    error.message.includes("newer Authoring Source metadata")
  )
    return metadataNotice(error.message);
  if (
    phase === "recovery" &&
    error instanceof Error &&
    error.message === "Recovered construction did not match the snapshot."
  ) {
    return {
      phase: "recovery",
      code: "RECOVERY_SNAPSHOT_MISMATCH",
      message:
        "Recovered construction did not match the snapshot. The current workspace was kept; retry from a different Recovery Draft or download the current construction.",
    };
  }
  if (error instanceof ApplyFailure) {
    const reason =
      error.reason && applyCodes.has(error.reason) ? `/${error.reason}` : "";
    const code = `${error.code}${reason}`;
    const messages: Record<string, string> = {
      APPLY_TARGET_MISSING:
        "The Editing Target is missing. Keep this Draft Source and restore its Orphaned Source as a new text.",
      APPLY_SNAPSHOT_UNAVAILABLE:
        "Apply could not capture the previous construction. Draft Source is kept. Retry after reloading the construction.",
      APPLY_GEOGEBRA_REJECTED:
        "GeoGebra rejected the definition. The previous construction and Draft Source were kept. Review the source and Retry Apply.",
      APPLY_POSTCONDITION_FAILED:
        "GeoGebra did not retain the intended text state. The previous construction and Draft Source were restored. Retry Apply or report this diagnostic.",
      APPLY_METADATA_FAILED:
        "Authoring metadata could not be saved. The previous construction and Draft Source were restored. Retry Apply.",
      APPLY_MUTATION_FAILED:
        "The construction update failed. The previous construction and Draft Source were restored. Retry Apply.",
      APPLY_COMPILER_REJECTED:
        "Correct the highlighted Authoring Source errors, then Retry Apply. The current construction was kept.",
      APPLY_ROLLED_BACK:
        "Apply failed. The previous construction and Draft Source were kept. Review the diagnostic, then Retry Apply.",
      APPLY_ROLLBACK_FAILED:
        "Apply could not restore the previous construction. Further Apply is disabled. Download the current construction if possible, then reload or report this diagnostic. Your Draft Source is retained locally.",
    };
    const message =
      error.code === "APPLY_ROLLED_BACK" &&
      error.reason === "APPLY_METADATA_FAILED"
        ? messages.APPLY_METADATA_FAILED!
        : messages[error.code]!;
    return { phase: "transaction", code, message };
  }
  const codes: Record<FailurePhase, string> = {
    compiler: "COMPILER_REJECTED",
    applet: "APPLET_LOAD_FAILED",
    transaction: "TRANSACTION_FAILED",
    metadata: "METADATA_INVALID",
    file: "FILE_OPERATION_FAILED",
    recovery: "RECOVERY_OPERATION_FAILED",
    compatibility: "COMPATIBILITY_ERROR",
  };
  const messages: Record<FailurePhase, string> = {
    compiler:
      "Correct the highlighted Authoring Source errors and retry Apply.",
    applet:
      "GeoGebra could not load. Retry GeoGebra; editing actions remain unavailable until it is ready.",
    transaction:
      "The construction action failed. Your Draft Source remains available; retry after checking the construction.",
    metadata:
      "Authoring metadata is unavailable or incompatible. The construction remains usable; affected text is read-only until metadata is recovered.",
    file: "The file operation failed. The current workspace was kept. Check the .ggb file and retry.",
    recovery:
      "Local recovery failed. The current workspace was kept. Retry recovery or download the construction.",
    compatibility:
      "This GeoGebra version is incompatible. Retry the pinned version before editing.",
  };
  return { phase, code: codes[phase], message: messages[phase] };
}

export function metadataNotice(message: string): FailureNotice {
  const known = [
    [
      "newer Authoring Source metadata",
      "METADATA_NEWER",
      "This construction contains newer Authoring Source metadata. It remains usable and the metadata is preserved without writes.",
    ],
    [
      "metadata is ambiguous",
      "METADATA_AMBIGUOUS",
      "Authoring Source metadata has multiple valid carriers. The construction remains usable; resolve the ambiguity before editing managed text.",
    ],
    [
      "metadata is malformed",
      "METADATA_MALFORMED",
      "Authoring Source metadata is malformed. The construction remains usable and its original carrier is preserved.",
    ],
    [
      "metadata is missing",
      "METADATA_MISSING",
      "Authoring Source metadata is missing. Existing text remains usable as unmanaged text.",
    ],
  ] as const;
  const match = known.find(([phrase]) => message.includes(phrase));
  const code = match?.[1] ?? "METADATA_INVALID";
  return {
    phase: "metadata",
    code,
    message: match?.[2] ?? failureNotice(message, "metadata").message,
  };
}
