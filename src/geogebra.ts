import {
  compileSource,
  rewriteGlobalReferences,
  type SymbolInfo,
} from "./compiler";
import {
  decodeMetadata,
  emptyMetadata,
  encodeMetadata,
  METADATA_LABEL,
  METADATA_PREFIX,
  type ManagedDocument,
  type MetadataEnvelope,
} from "./metadata";

export const GEOGEBRA_VERSION = "5.4.920.0";
const CODEBASE = `https://www.geogebra.org/apps/${GEOGEBRA_VERSION}/web3d`;
const DEPLOY_SCRIPT = "https://www.geogebra.org/apps/deployggb.js";
const LOAD_TIMEOUT_MS = 30_000;

export type AppletState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; version: string }
  | { kind: "version-mismatch"; actual: string }
  | { kind: "error"; message: string };

export type ConstructionEvent =
  | { kind: "selection"; selected: SymbolInfo[] }
  | { kind: "object"; change: "add" | "update" | "remove"; label: string }
  | { kind: "rename"; oldLabel: string; label: string }
  | { kind: "metadata-error"; message: string }
  | { kind: "clear" | "undo" | "redo" };

function clientEvent(raw: unknown): { type: string; target: string } | null {
  if (Array.isArray(raw)) {
    const [type, target] = raw;
    return typeof type === "string"
      ? { type, target: typeof target === "string" ? target : "" }
      : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const event = raw as Record<string, unknown>;
  return typeof event.type === "string"
    ? {
        type: event.type,
        target: typeof event.target === "string" ? event.target : "",
      }
    : null;
}

interface AppletApi {
  getVersion(): string;
  setWidth(width: number): void;
  setHeight(height: number): void;
  remove?(): void;
  getAllObjectNames?(): string[];
  getObjectType?(label: string): string;
  isDefined?(label: string): boolean;
  evalCommand?(command: string): boolean;
  evalCommandGetLabels?(command: string): string;
  exists?(label: string): boolean;
  getValueString?(label: string): string;
  getCaption?(label: string, substitutePlaceholders: boolean): string;
  getCommandString?(label: string, localized?: boolean): string;
  getViewProperties?(view: number): string;
  setCoords?(label: string, x: number, y: number): void;
  setVisible?(label: string, visible: boolean): void;
  setAuxiliary?(label: string, auxiliary: boolean): void;
  setFixed?(label: string, fixed: boolean, selectionAllowed: boolean): void;
  setCaption?(label: string, caption: string): void;
  getXML?(label?: string): string;
  setXML?(xml: string): void;
  setUndoPoint?(): void;
  getBase64?(callback: (base64: string) => void): void;
  setBase64?(base64: string, callback: () => void): void;
  registerAddListener?(listener: (label: string) => void): void;
  registerUpdateListener?(listener: (label: string) => void): void;
  registerRemoveListener?(listener: (label: string) => void): void;
  registerRenameListener?(
    listener: (oldLabel: string, label: string) => void,
  ): void;
  registerClearListener?(listener: () => void): void;
  registerClientListener?(listener: (event: unknown) => void): void;
}

export interface ManagedText extends ManagedDocument {
  id: string;
}

export interface OrphanedText extends ManagedText {
  candidates: string[];
}

export type ApplyFailureCode =
  | "APPLY_TARGET_MISSING"
  | "APPLY_SNAPSHOT_UNAVAILABLE"
  | "APPLY_GEOGEBRA_REJECTED"
  | "APPLY_POSTCONDITION_FAILED"
  | "APPLY_METADATA_FAILED"
  | "APPLY_MUTATION_FAILED"
  | "APPLY_COMPILER_REJECTED"
  | "APPLY_ROLLED_BACK"
  | "APPLY_ROLLBACK_FAILED";

export class ApplyFailure extends Error {
  constructor(
    readonly code: ApplyFailureCode,
    message: string,
    readonly reason?: ApplyFailureCode,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "ApplyFailure";
  }
}

function snapshotPresentation(
  api: AppletApi,
  label: string,
  description: string,
): () => boolean {
  const xml = api.getXML?.(label);
  const index = xml?.indexOf("<element") ?? -1;
  if (index < 0)
    throw new ApplyFailure(
      "APPLY_SNAPSHOT_UNAVAILABLE",
      `GeoGebra cannot snapshot the ${description} presentation.`,
    );
  const element = xml!.slice(index);
  const matches = () => {
    const current = api.getXML?.(label);
    return !!current && current.slice(current.indexOf("<element")) === element;
  };
  if (!matches())
    throw new ApplyFailure(
      "APPLY_SNAPSHOT_UNAVAILABLE",
      `GeoGebra cannot snapshot the ${description} presentation.`,
    );
  return matches;
}

interface AppletEmbed {
  setHTML5Codebase(url: string): void;
  inject(element: HTMLElement): void;
}

type AppletConstructor = new (
  parameters: Record<string, unknown>,
  html5: boolean,
) => AppletEmbed;

function getAppletConstructor(): AppletConstructor {
  const host = globalThis as typeof globalThis & {
    GGBApplet?: AppletConstructor;
  };
  if (!host.GGBApplet)
    throw new Error("GeoGebra bundle did not provide GGBApplet.");
  return host.GGBApplet;
}

function loadDeployScript(): Promise<void> {
  if (
    (globalThis as typeof globalThis & { GGBApplet?: AppletConstructor })
      .GGBApplet
  ) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = DEPLOY_SCRIPT;
    script.async = true;
    const timeout = window.setTimeout(
      () => finish(new Error("GeoGebra bundle timed out.")),
      LOAD_TIMEOUT_MS,
    );
    function finish(error?: Error) {
      window.clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else {
        resolve();
      }
    }
    script.onload = () => finish();
    script.onerror = () =>
      finish(new Error("GeoGebra bundle could not be loaded."));
    document.head.append(script);
  });
}

export class GeoGebraAdapter {
  readonly element: HTMLElement;
  private readonly notify: (state: AppletState) => void;
  private readonly loadScript: () => Promise<void>;
  private currentState: AppletState = { kind: "idle" };
  private api: AppletApi | undefined;
  private generation = 0;
  private readonly listeners = new Set<(event: ConstructionEvent) => void>();
  private readonly selectedLabels = new Set<string>();
  private applyHalted = false;
  private failedApplySnapshot: string | null = null;
  private recoveredLabels = new Map<string, string>();
  private recoveryCandidates = new Map<string, string[]>();
  private recoveryMetadataValue = "";
  private readonly deletedManagedIds = new Set<string>();
  private readonly ambiguousExactIds = new Set<string>();
  private historyReconcile = false;
  private renameQueue: Promise<void> = Promise.resolve();

  constructor(
    element: HTMLElement,
    notify: (state: AppletState) => void,
    loadScript = loadDeployScript,
  ) {
    this.element = element;
    this.notify = notify;
    this.loadScript = loadScript;
  }

  get state(): AppletState {
    return this.currentState;
  }

  get hasRecoverableApplySnapshot(): boolean {
    return this.failedApplySnapshot !== null;
  }

  get recoverableApplySnapshot(): string | null {
    return this.failedApplySnapshot;
  }

  restoreApplySnapshot(snapshot: string): void {
    const api = this.readyApi();
    if (!api.setXML || !api.getXML)
      throw new Error("GeoGebra recovery is unavailable.");
    api.setXML(snapshot);
    if (api.getXML() !== snapshot)
      throw new Error("Recovered construction did not match the snapshot.");
    this.applyHalted = false;
    this.failedApplySnapshot = null;
  }

  onEvent(listener: (event: ConstructionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ConstructionEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private selectionChanged(): void {
    const symbols = this.getSymbols();
    this.emit({
      kind: "selection",
      selected: [...this.selectedLabels]
        .map((label) => symbols.find((symbol) => symbol.label === label))
        .filter((symbol): symbol is SymbolInfo => !!symbol),
    });
  }

  private registerListeners(api: AppletApi): void {
    api.registerAddListener?.((label) =>
      this.emit({ kind: "object", change: "add", label }),
    );
    api.registerUpdateListener?.((label) =>
      this.emit({ kind: "object", change: "update", label }),
    );
    api.registerRemoveListener?.((label) => {
      queueMicrotask(() => {
        if (api.getObjectType?.(label) === "text") return;
        for (const [id, document] of Object.entries(
          this.metadata().envelope.documents,
        ))
          if (document.targetLabel === label) this.deletedManagedIds.add(id);
      });
      this.selectedLabels.delete(label);
      this.emit({ kind: "object", change: "remove", label });
      this.selectionChanged();
    });
    api.registerRenameListener?.((oldLabel, label) => {
      if (this.selectedLabels.delete(oldLabel)) this.selectedLabels.add(label);
      if (Object.keys(this.metadata().envelope.documents).length === 0)
        this.emit({ kind: "rename", oldLabel, label });
      else
        this.renameQueue = this.renameQueue
          .then(() => this.handleRename(oldLabel, label))
          .then(() => this.emit({ kind: "rename", oldLabel, label }))
          .catch((error: unknown) => {
            this.emit({
              kind: "metadata-error",
              message:
                error instanceof Error
                  ? error.message
                  : "Rename metadata could not be updated.",
            });
          });
      this.selectionChanged();
    });
    api.registerClearListener?.(() => {
      this.selectedLabels.clear();
      this.emit({ kind: "clear" });
      this.selectionChanged();
    });
    api.registerClientListener?.((raw) => {
      const event = clientEvent(raw);
      if (!event) return;
      if (event.type === "select" && event.target) {
        this.selectedLabels.add(event.target);
        this.selectionChanged();
      } else if (event.type === "deselect") {
        if (event.target) this.selectedLabels.delete(event.target);
        else this.selectedLabels.clear();
        this.selectionChanged();
      } else if (event.type === "undo" || event.type === "redo") {
        this.historyReconcile = true;
        this.emit({ kind: event.type });
      }
    });
  }

  async start(): Promise<void> {
    const generation = ++this.generation;
    this.applyHalted = false;
    this.failedApplySnapshot = null;
    this.api?.remove?.();
    this.api = undefined;
    this.selectedLabels.clear();
    this.recoveredLabels.clear();
    this.recoveryCandidates.clear();
    this.deletedManagedIds.clear();
    this.ambiguousExactIds.clear();
    this.historyReconcile = false;
    this.element.replaceChildren();
    this.changeState({ kind: "loading" });

    try {
      await this.loadScript();
      if (generation !== this.generation) return;
      const GGBApplet = getAppletConstructor();
      await new Promise<void>((resolve) => {
        let settled = false;
        const timeout = window.setTimeout(
          () => fail(new Error("GeoGebra applet initialization timed out.")),
          LOAD_TIMEOUT_MS,
        );
        const finish = (state: AppletState) => {
          if (settled || generation !== this.generation) return;
          settled = true;
          window.clearTimeout(timeout);
          this.changeState(state);
          resolve();
        };
        const fail = (error: Error) =>
          finish({ kind: "error", message: error.message });
        try {
          const applet = new GGBApplet(
            {
              appName: "classic",
              width: Math.max(1, Math.round(this.element.clientWidth)),
              height: Math.max(1, Math.round(this.element.clientHeight)),
              showToolBar: true,
              enableUndoRedo: true,
              showMenuBar: false,
              showAlgebraInput: false,
              enableFileFeatures: false,
              showResetIcon: false,
              useBrowserForJS: true,
              appletOnLoad: (api: AppletApi) => {
                if (settled || generation !== this.generation) return;
                try {
                  const actual = api.getVersion();
                  if (actual !== GEOGEBRA_VERSION) {
                    api.remove?.();
                    finish({ kind: "version-mismatch", actual });
                    return;
                  }
                  this.api = api;
                  this.registerListeners(api);
                  this.resize();
                  finish({ kind: "ready", version: actual });
                } catch (error) {
                  fail(
                    error instanceof Error
                      ? error
                      : new Error("GeoGebra initialization failed."),
                  );
                }
              },
            },
            true,
          );
          applet.setHTML5Codebase(CODEBASE);
          applet.inject(this.element);
        } catch (error) {
          fail(
            error instanceof Error
              ? error
              : new Error("GeoGebra initialization failed."),
          );
        }
      });
      if (this.currentState.kind === "ready") await this.reconcileMetadata();
    } catch (error) {
      if (generation !== this.generation) return;
      this.changeState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "GeoGebra initialization failed.",
      });
    }
  }

  retry(): Promise<void> {
    return this.start();
  }

  getSymbols(): SymbolInfo[] {
    if (!this.api?.getAllObjectNames) return [];
    try {
      const metadataLabel =
        this.currentState.kind === "ready" ? this.metadata().label : null;
      return this.api
        .getAllObjectNames()
        .filter((label) => label !== metadataLabel)
        .map((label) => ({
          label,
          type: this.api?.getObjectType?.(label) ?? "unknown",
          defined: this.api?.isDefined?.(label) ?? true,
        }));
    } catch {
      return [];
    }
  }

  private readyApi(): AppletApi {
    if (this.currentState.kind !== "ready" || !this.api)
      throw new Error("GeoGebra is not ready.");
    return this.api;
  }

  private metadata(): { label: string | null; envelope: MetadataEnvelope } {
    const api = this.readyApi();
    for (const label of api.getAllObjectNames?.() ?? []) {
      if (
        !label.startsWith(METADATA_PREFIX) ||
        api.getObjectType?.(label) !== "text"
      )
        continue;
      const value = String(api.getValueString?.(label) ?? "");
      const envelope = decodeMetadata(value);
      if (envelope) return { label, envelope };
    }
    return { label: null, envelope: emptyMetadata() };
  }

  private async handleRename(oldLabel: string, label: string): Promise<void> {
    const api = this.readyApi();
    const metadata = this.metadata();
    if (!metadata.label) return;
    const afterSymbols = this.getSymbols();
    const renamed = afterSymbols.find((symbol) => symbol.label === label);
    const beforeSymbols = [
      ...afterSymbols.filter((symbol) => symbol.label !== label),
      ...(renamed ? [{ ...renamed, label: oldLabel }] : []),
    ];
    let changed = false;
    for (const [id, document] of Object.entries(metadata.envelope.documents)) {
      const source = rewriteGlobalReferences(
        document.source,
        oldLabel,
        label,
        beforeSymbols,
      ).source;
      const targetLabel =
        document.targetLabel === oldLabel && !this.deletedManagedIds.has(id)
          ? label
          : document.targetLabel;
      if (source === document.source && targetLabel === document.targetLabel)
        continue;
      document.source = source;
      document.targetLabel = targetLabel;
      if (api.getObjectType?.(targetLabel) === "text")
        document.compiledFingerprint = await this.fingerprint(targetLabel);
      changed = true;
    }
    if (!changed) return;
    const snapshot = api.getXML?.();
    const originalValue = String(api.getValueString?.(metadata.label) ?? "");
    if (!snapshot || !api.setXML || !api.setUndoPoint)
      throw new Error(
        "GeoGebra cannot verify rename metadata or its history point.",
      );
    try {
      this.writeMetadata(metadata.label, metadata.envelope);
      api.setUndoPoint();
      await this.reconcileMetadata();
    } catch (error) {
      api.setXML(snapshot);
      if (String(api.getValueString?.(metadata.label) ?? "") !== originalValue)
        throw new Error("Rename metadata rollback failed.", { cause: error });
      throw error;
    }
  }

  private hasNewerMetadata(): boolean {
    const api = this.readyApi();
    for (const label of api.getAllObjectNames?.() ?? []) {
      if (
        !label.startsWith(METADATA_PREFIX) ||
        api.getObjectType?.(label) !== "text"
      )
        continue;
      const value = String(api.getValueString?.(label) ?? "");
      if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) continue;
      try {
        const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const parsed: unknown = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
        if (!parsed || typeof parsed !== "object") continue;
        const record = parsed as Record<string, unknown>;
        if (
          record.application === "geogebra-latex-editor" &&
          ((typeof record.schemaVersion === "number" &&
            record.schemaVersion > 1) ||
            (typeof record.languageVersion === "number" &&
              record.languageVersion > 1))
        )
          return true;
      } catch {
        // Other prefix collisions are not owned metadata.
      }
    }
    return false;
  }

  getManagedTexts(): ManagedText[] {
    const api = this.readyApi();
    const metadata = this.metadata();
    const recoveryValid =
      metadata.label !== null &&
      String(api.getValueString?.(metadata.label) ?? "") ===
        this.recoveryMetadataValue;
    return Object.entries(metadata.envelope.documents)
      .map(([id, document]) => ({
        id,
        ...document,
        targetLabel:
          api.getObjectType?.(document.targetLabel) === "text" &&
          !this.deletedManagedIds.has(id)
            ? document.targetLabel
            : recoveryValid
              ? (this.recoveredLabels.get(id) ?? document.targetLabel)
              : document.targetLabel,
      }))
      .filter(
        (document) =>
          !this.deletedManagedIds.has(document.id) &&
          !this.ambiguousExactIds.has(document.id) &&
          api.getObjectType?.(document.targetLabel) === "text",
      );
  }

  getOrphanedTexts(): OrphanedText[] {
    if (this.currentState.kind !== "ready") return [];
    const managed = new Set(this.getManagedTexts().map((text) => text.id));
    const metadata = this.metadata();
    const recoveryValid =
      metadata.label !== null &&
      String(this.readyApi().getValueString?.(metadata.label) ?? "") ===
        this.recoveryMetadataValue;
    return Object.entries(metadata.envelope.documents)
      .filter(([id]) => !managed.has(id))
      .map(([id, document]) => ({
        id,
        ...document,
        candidates: recoveryValid
          ? (this.recoveryCandidates.get(id) ?? [])
          : [],
      }));
  }

  async discardOrphanedText(id: string): Promise<void> {
    const api = this.readyApi();
    const metadata = this.metadata();
    if (
      !metadata.label ||
      !metadata.envelope.documents[id] ||
      this.getManagedTexts().some((text) => text.id === id)
    )
      throw new Error("Orphaned Source is no longer available.");
    const snapshot = api.getXML?.();
    if (!snapshot || !api.setXML || !api.setUndoPoint)
      throw new Error("GeoGebra cannot discard Orphaned Source safely.");
    delete metadata.envelope.documents[id];
    try {
      this.writeMetadata(metadata.label, metadata.envelope);
      if (this.metadata().envelope.documents[id])
        throw new Error("GeoGebra retained the discarded Orphaned Source.");
      api.setUndoPoint();
      this.deletedManagedIds.delete(id);
      await this.reconcileMetadata();
    } catch (error) {
      api.setXML(snapshot);
      throw error;
    }
  }

  async restoreOrphanedText(
    id: string,
    source?: string,
    simplify?: boolean,
  ): Promise<ManagedText> {
    const api = this.readyApi();
    const metadata = this.metadata();
    const document = metadata.envelope.documents[id];
    if (
      !document ||
      !metadata.label ||
      this.getManagedTexts().some((text) => text.id === id)
    )
      throw new Error("Orphaned Source is no longer available.");
    const restoredSource = source ?? document.source;
    const restoredSimplify = simplify ?? document.simplify;
    const result = compileSource(restoredSource, {
      simplify: restoredSimplify,
      symbols: this.getSymbols(),
    });
    if (!result.expression)
      throw new Error(
        "Resolve Authoring Source errors before restoring this Orphaned Source.",
      );
    const snapshot = api.getXML?.();
    if (
      !snapshot ||
      !api.setXML ||
      !api.evalCommandGetLabels ||
      !api.evalCommand ||
      !api.setUndoPoint
    )
      throw new Error("GeoGebra cannot restore Orphaned Source safely.");
    try {
      const label = String(api.evalCommandGetLabels('" "') ?? "").split(",")[0];
      if (!label || api.getObjectType?.(label) !== "text")
        throw new Error("GeoGebra did not create a new text target.");
      api.evalCommand(`${label}=${result.expression}`);
      if (
        api.getObjectType?.(label) !== "text" ||
        !api.getCommandString?.(label, false)
      )
        throw new Error("GeoGebra did not retain the restored definition.");
      const updated: ManagedDocument = {
        ...document,
        targetLabel: label,
        source: restoredSource,
        simplify: restoredSimplify,
        compiledFingerprint: await this.fingerprint(label),
      };
      metadata.envelope.documents[id] = updated;
      this.writeMetadata(metadata.label, metadata.envelope);
      api.setUndoPoint();
      this.deletedManagedIds.delete(id);
      await this.reconcileMetadata();
      return { id, ...updated };
    } catch (error) {
      api.setXML(snapshot);
      throw error;
    }
  }

  async reconcileMetadata(allowRecovery = true): Promise<void> {
    const api = this.readyApi();
    const metadata = this.metadata();
    const metadataValue = metadata.label
      ? String(api.getValueString?.(metadata.label) ?? "")
      : "";
    if (this.historyReconcile) {
      this.historyReconcile = false;
      for (const [id, document] of Object.entries(metadata.envelope.documents))
        if (api.getObjectType?.(document.targetLabel) !== "text")
          this.deletedManagedIds.add(id);
      for (const id of this.deletedManagedIds) {
        const document = metadata.envelope.documents[id];
        if (
          document &&
          api.getObjectType?.(document.targetLabel) === "text" &&
          (await this.fingerprint(document.targetLabel)) ===
            document.compiledFingerprint
        )
          this.deletedManagedIds.delete(id);
      }
    }
    if (!allowRecovery) {
      if (metadataValue !== this.recoveryMetadataValue) {
        this.recoveredLabels.clear();
        this.recoveryCandidates.clear();
        this.ambiguousExactIds.clear();
        this.recoveryMetadataValue = metadataValue;
      } else {
        for (const [id, label] of this.recoveredLabels)
          if (api.getObjectType?.(label) !== "text")
            this.recoveredLabels.delete(id);
      }
      return;
    }
    this.recoveredLabels.clear();
    this.recoveryCandidates.clear();
    this.ambiguousExactIds.clear();
    this.recoveryMetadataValue = metadataValue;
    const documents = Object.entries(metadata.envelope.documents);
    const exactLabels = new Map<string, string[]>();
    for (const [id, document] of documents) {
      if (
        this.deletedManagedIds.has(id) ||
        api.getObjectType?.(document.targetLabel) !== "text"
      )
        continue;
      const ids = exactLabels.get(document.targetLabel) ?? [];
      ids.push(id);
      exactLabels.set(document.targetLabel, ids);
    }
    for (const ids of exactLabels.values())
      if (ids.length > 1) for (const id of ids) this.ambiguousExactIds.add(id);
    const reserved = new Set(
      documents
        .filter(
          ([id, document]) =>
            !this.deletedManagedIds.has(id) &&
            !this.ambiguousExactIds.has(id) &&
            api.getObjectType?.(document.targetLabel) === "text",
        )
        .map(([, document]) => document.targetLabel),
    );
    const candidates = (api.getAllObjectNames?.() ?? []).filter(
      (label) =>
        label !== metadata.label &&
        api.getObjectType?.(label) === "text" &&
        !reserved.has(label),
    );
    const fingerprints = new Map<string, string>();
    await Promise.all(
      candidates.map(async (label) =>
        fingerprints.set(label, await this.fingerprint(label)),
      ),
    );
    const matchesById = new Map(
      documents
        .filter(
          ([id, document]) =>
            this.deletedManagedIds.has(id) ||
            this.ambiguousExactIds.has(id) ||
            api.getObjectType?.(document.targetLabel) !== "text",
        )
        .map(
          ([id, document]) =>
            [
              id,
              candidates.filter(
                (label) =>
                  fingerprints.get(label) === document.compiledFingerprint,
              ),
            ] as const,
        ),
    );
    for (const [id, matches] of matchesById) {
      if (
        matches.length === 1 &&
        [...matchesById.values()].filter((other) => other.includes(matches[0]!))
          .length === 1
      )
        this.recoveredLabels.set(id, matches[0]!);
      else if (matches.length) this.recoveryCandidates.set(id, matches);
    }
  }

  getUnmanagedTextSnapshot(label: string): string {
    const api = this.readyApi();
    if (api.getObjectType?.(label) !== "text" || !api.getValueString)
      throw new Error("The Unmanaged Text Object is no longer available.");
    return String(api.getValueString(label));
  }

  async adoptUnmanagedText(
    label: string,
    expectedRenderedLatex: string,
  ): Promise<ManagedText> {
    const api = this.readyApi();
    if (this.hasNewerMetadata())
      throw new Error(
        "Cannot adopt while this construction contains newer Authoring Source metadata.",
      );
    const metadata = this.metadata();
    if (
      api.getObjectType?.(label) !== "text" ||
      this.getManagedTexts().some((text) => text.targetLabel === label)
    )
      throw new Error("The object is no longer an Unmanaged Text Object.");
    if (this.getUnmanagedTextSnapshot(label) !== expectedRenderedLatex)
      throw new Error(
        "The rendered LaTeX changed. Reopen the text and confirm its current snapshot.",
      );
    const snapshot = api.getXML?.();
    if (
      !snapshot ||
      !api.setXML ||
      !api.getCommandString ||
      !api.getCaption ||
      !api.evalCommand ||
      !api.setUndoPoint
    )
      throw new Error(
        "GeoGebra cannot snapshot Adoption for rollback and undo.",
      );
    const presentationMatches = snapshotPresentation(
      api,
      label,
      "Unmanaged Text Object",
    );
    const command = api.getCommandString(label, false);
    const caption = api.getCaption(label, false);
    const selectedBefore = [...this.selectedLabels];
    const selectionMatches = () =>
      selectedBefore.length === this.selectedLabels.size &&
      selectedBefore.every((selected) => this.selectedLabels.has(selected));
    const restoreSelection = () => {
      if (!selectionMatches())
        api.evalCommand!(`SelectObjects(${selectedBefore.join(",")})`);
      if (!selectionMatches())
        throw new Error("Adoption changed the GeoGebra selection.");
    };
    const id = crypto.randomUUID();
    const document: ManagedDocument = {
      targetLabel: label,
      source: expectedRenderedLatex.replace(/@/g, "@@"),
      simplify: false,
      compiledFingerprint: await this.fingerprint(label),
    };
    const metadataLabel = this.metadataLabel(metadata.label);
    metadata.envelope.documents[id] = document;
    try {
      this.writeMetadata(metadataLabel, metadata.envelope);
      if (
        api.getObjectType?.(label) !== "text" ||
        this.getUnmanagedTextSnapshot(label) !== expectedRenderedLatex ||
        api.getCommandString(label, false) !== command ||
        api.getCaption(label, false) !== caption ||
        !presentationMatches()
      )
        throw new Error(
          "Adoption changed the object's definition or presentation.",
        );
      const observed = this.metadata();
      if (
        observed.label !== metadataLabel ||
        encodeMetadata(observed.envelope) !== encodeMetadata(metadata.envelope)
      )
        throw new Error("Adoption metadata could not be verified.");
      restoreSelection();
      api.setUndoPoint();
      return { id, ...document };
    } catch (error) {
      api.setXML(snapshot);
      restoreSelection();
      if (api.getXML?.() !== snapshot)
        throw new Error(
          "Adoption rollback failed; reload the construction before trying again.",
          { cause: error },
        );
      throw error;
    }
  }

  private metadataLabel(existing: string | null): string {
    if (existing) return existing;
    const api = this.readyApi();
    if (!api.exists?.(METADATA_LABEL)) return METADATA_LABEL;
    for (let suffix = 1; suffix < 10000; suffix++) {
      const label = `${METADATA_PREFIX}_${suffix}`;
      if (!api.exists?.(label)) return label;
    }
    throw new Error("No metadata label is available.");
  }

  private writeMetadata(label: string, envelope: MetadataEnvelope): void {
    const api = this.readyApi();
    const encoded = encodeMetadata(envelope);
    api.evalCommand?.(`${label}="${encoded}"`);
    if (api.getObjectType?.(label) !== "text")
      throw new Error("Metadata text was not created.");
    api.setVisible?.(label, false);
    api.setAuxiliary?.(label, true);
    api.setFixed?.(label, true, false);
    if (String(api.getValueString?.(label) ?? "") !== encoded)
      throw new Error("Metadata verification failed.");
  }

  private async fingerprint(label: string): Promise<string> {
    const command = String(
      this.readyApi().getCommandString?.(label, false) ?? "",
    );
    const bytes = new TextEncoder().encode(command);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  async createManagedText(): Promise<ManagedText> {
    const api = this.readyApi();
    const snapshot = api.getXML?.();
    try {
      const label = String(api.evalCommandGetLabels?.('" "') ?? "").split(
        ",",
      )[0];
      if (!label || api.getObjectType?.(label) !== "text")
        throw new Error("GeoGebra did not create a text object.");
      api.evalCommand?.(`${label}=FormulaText(Simplify(""))`);
      if (api.getObjectType?.(label) !== "text")
        throw new Error("GeoGebra did not retain the empty text object.");
      if (!api.getViewProperties || !api.setCoords)
        throw new Error(
          "GeoGebra cannot position the text in the visible view.",
        );
      const view = JSON.parse(String(api.getViewProperties?.(1) ?? "{}")) as {
        xMin?: number;
        yMin?: number;
        width?: number;
        height?: number;
        invXscale?: number;
        invYscale?: number;
      };
      if (
        ![
          view.xMin,
          view.yMin,
          view.width,
          view.height,
          view.invXscale,
          view.invYscale,
        ].every((value) => typeof value === "number")
      )
        throw new Error("GeoGebra did not report visible view bounds.");
      api.setCoords(
        label,
        view.xMin! + (view.width! * view.invXscale!) / 2,
        view.yMin! + (view.height! * view.invYscale!) / 2,
      );
      const metadata = this.metadata();
      const document: ManagedDocument = {
        targetLabel: label,
        source: "",
        simplify: true,
        compiledFingerprint: await this.fingerprint(label),
      };
      const id = crypto.randomUUID();
      metadata.envelope.documents[id] = document;
      this.writeMetadata(this.metadataLabel(metadata.label), metadata.envelope);
      api.setUndoPoint?.();
      return { id, ...document };
    } catch (error) {
      if (snapshot) api.setXML?.(snapshot);
      throw error;
    }
  }

  async applyManagedText(
    id: string,
    source: string,
    simplify: boolean,
    expression: string,
  ): Promise<ManagedText> {
    if (this.applyHalted)
      throw new ApplyFailure(
        "APPLY_ROLLBACK_FAILED",
        "Apply is disabled after a failed rollback. Reload the construction before trying again.",
      );
    const api = this.readyApi();
    const metadata = this.metadata();
    const storedDocument = metadata.envelope.documents[id];
    const recovered = this.getManagedTexts().find((text) => text.id === id);
    const document =
      storedDocument && recovered
        ? { ...storedDocument, targetLabel: recovered.targetLabel }
        : storedDocument;
    if (!document || api.getObjectType?.(document.targetLabel) !== "text")
      throw new ApplyFailure(
        "APPLY_TARGET_MISSING",
        "Editing Target no longer exists.",
      );
    if (
      !api.evalCommand ||
      !api.getCommandString ||
      !api.getValueString ||
      !api.getCaption ||
      !api.setCaption ||
      !api.setUndoPoint
    )
      throw new ApplyFailure(
        "APPLY_SNAPSHOT_UNAVAILABLE",
        "GeoGebra cannot verify Apply and record its undo point.",
      );
    const snapshot = api.getXML?.();
    if (!snapshot || !api.setXML || !metadata.label)
      throw new ApplyFailure(
        "APPLY_SNAPSHOT_UNAVAILABLE",
        "GeoGebra cannot snapshot the Applied Source state.",
      );
    const metadataLabel = metadata.label;
    const selectedBefore = [...this.selectedLabels];
    const selectionMatches = () =>
      selectedBefore.length === this.selectedLabels.size &&
      selectedBefore.every((label) => this.selectedLabels.has(label));
    const restoreSelection = () => {
      if (!selectionMatches())
        api.evalCommand!(`SelectObjects(${selectedBefore.join(",")})`);
      if (!selectionMatches())
        throw new ApplyFailure(
          "APPLY_POSTCONDITION_FAILED",
          "GeoGebra did not restore the selection.",
        );
    };
    const presentationXmlMatches = snapshotPresentation(
      api,
      document.targetLabel,
      "Editing Target",
    );
    const previousCaption = api.getCaption(document.targetLabel, false);
    const presentationMatches = () =>
      presentationXmlMatches() &&
      api.getCaption?.(document.targetLabel, false) === previousCaption;
    const restoreCaption = () => {
      if (api.getCaption?.(document.targetLabel, false) !== previousCaption)
        api.setCaption?.(document.targetLabel, previousCaption);
      if (!presentationMatches())
        throw new ApplyFailure(
          "APPLY_POSTCONDITION_FAILED",
          "GeoGebra changed the Editing Target presentation.",
        );
    };
    const metadataPresentationMatches = snapshotPresentation(
      api,
      metadata.label,
      "Authoring Source metadata",
    );
    const previousCommand = api.getCommandString?.(document.targetLabel, false);
    const previousValue = api.getValueString?.(document.targetLabel);
    const previousMetadata = String(api.getValueString?.(metadata.label) ?? "");
    const previousExpression = compileSource(document.source, {
      simplify: document.simplify,
      symbols: this.getSymbols(),
    }).expression;
    const snapshotMatches = () =>
      api.getObjectType?.(document.targetLabel) === "text" &&
      api.getObjectType?.(metadataLabel) === "text" &&
      api.getCommandString?.(document.targetLabel, false) === previousCommand &&
      api.getValueString?.(document.targetLabel) === previousValue &&
      String(api.getValueString?.(metadataLabel) ?? "") === previousMetadata &&
      presentationMatches() &&
      metadataPresentationMatches();
    try {
      // Observe GeoGebra's normalized command before writing its fingerprint.
      // Restore the snapshot so the final target/metadata write is one operation.
      api.evalCommand?.(`${document.targetLabel}=${expression}`);
      if (api.getObjectType?.(document.targetLabel) !== "text")
        throw new ApplyFailure(
          "APPLY_GEOGEBRA_REJECTED",
          "GeoGebra did not retain the Editing Target.",
        );
      restoreCaption();
      const stagedCommand = api.getCommandString?.(document.targetLabel, false);
      const stagedValue = api.getValueString?.(document.targetLabel);
      if (
        !stagedCommand ||
        (stagedCommand === previousCommand && expression !== previousExpression)
      )
        throw new ApplyFailure(
          "APPLY_GEOGEBRA_REJECTED",
          "GeoGebra rejected the Compiled Definition.",
        );
      if (!presentationMatches())
        throw new ApplyFailure(
          "APPLY_POSTCONDITION_FAILED",
          "GeoGebra changed the Editing Target presentation.",
        );
      if (
        String(api.getValueString?.(metadata.label) ?? "") !==
          previousMetadata ||
        !metadataPresentationMatches()
      )
        throw new ApplyFailure(
          "APPLY_METADATA_FAILED",
          "GeoGebra changed Authoring Source metadata while staging.",
        );
      const updated: ManagedDocument = {
        targetLabel: document.targetLabel,
        source,
        simplify,
        compiledFingerprint: await this.fingerprint(document.targetLabel),
      };
      metadata.envelope.documents[id] = updated;
      const encoded = encodeMetadata(metadata.envelope);
      api.setXML(snapshot);
      restoreCaption();
      if (!snapshotMatches())
        throw new ApplyFailure(
          "APPLY_POSTCONDITION_FAILED",
          "GeoGebra did not restore the pre-Apply state.",
        );
      api.evalCommand?.(
        `${document.targetLabel}=${expression}\n${metadata.label}="${encoded}"`,
      );
      restoreCaption();
      if (
        api.getObjectType?.(document.targetLabel) !== "text" ||
        api.getCommandString?.(document.targetLabel, false) !== stagedCommand ||
        api.getValueString?.(document.targetLabel) !== stagedValue
      )
        throw new ApplyFailure(
          "APPLY_POSTCONDITION_FAILED",
          "GeoGebra did not retain the Compiled Definition.",
        );
      if (String(api.getValueString?.(metadata.label) ?? "") !== encoded)
        throw new ApplyFailure(
          "APPLY_METADATA_FAILED",
          "Metadata verification failed.",
        );
      const observedMetadata = decodeMetadata(
        String(api.getValueString?.(metadata.label) ?? ""),
      );
      if (
        api.getObjectType?.(metadata.label) !== "text" ||
        !observedMetadata ||
        encodeMetadata(observedMetadata) !== encoded ||
        !metadataPresentationMatches()
      )
        throw new ApplyFailure(
          "APPLY_METADATA_FAILED",
          "Metadata verification failed.",
        );
      if (!presentationMatches())
        throw new ApplyFailure(
          "APPLY_POSTCONDITION_FAILED",
          "GeoGebra changed the Editing Target presentation.",
        );
      restoreSelection();
      api.setUndoPoint();
      this.failedApplySnapshot = null;
      return { id, ...updated };
    } catch (error) {
      const reason =
        error instanceof ApplyFailure ? error.code : "APPLY_MUTATION_FAILED";
      try {
        api.setXML(snapshot);
        restoreCaption();
        restoreSelection();
        if (!snapshotMatches())
          throw new Error(
            "Rollback postconditions did not match the snapshot.",
            { cause: error },
          );
      } catch (rollbackError) {
        this.applyHalted = true;
        this.failedApplySnapshot = snapshot;
        throw new ApplyFailure(
          "APPLY_ROLLBACK_FAILED",
          "Apply rollback failed. Draft Source and the pre-Apply snapshot remain in this tab.",
          reason,
          rollbackError,
        );
      }
      throw new ApplyFailure(
        "APPLY_ROLLED_BACK",
        "Apply failed; the previous construction state was restored and Draft Source was retained.",
        reason,
        error,
      );
    }
  }

  exportBase64(): Promise<string> {
    const api = this.readyApi();
    return new Promise((resolve, reject) => {
      if (!api.getBase64)
        return reject(new Error("GeoGebra export is unavailable."));
      api.getBase64((value) =>
        value
          ? resolve(String(value))
          : reject(new Error("GeoGebra export failed.")),
      );
    });
  }

  async importBase64(base64: string): Promise<void> {
    const api = this.readyApi();
    if (!api.setBase64) throw new Error("GeoGebra import is unavailable.");
    await new Promise<void>((resolve) => api.setBase64!(base64, resolve));
    await this.reconcileMetadata();
  }

  resize(): void {
    if (!this.api) return;
    const bounds = this.element.parentElement ?? this.element;
    const width = Math.round(bounds.clientWidth);
    const height = Math.round(bounds.clientHeight);
    if (width > 0 && height > 0) {
      this.element.style.width = `${width}px`;
      this.element.style.height = `${height}px`;
      this.api.setWidth(width);
      this.api.setHeight(height);
    }
  }

  private changeState(state: AppletState): void {
    this.currentState = state;
    this.notify(state);
  }
}
