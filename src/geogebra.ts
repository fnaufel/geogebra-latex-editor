import { compileSource, type SymbolInfo } from "./compiler";
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
  getCommandString?(label: string, localized?: boolean): string;
  getViewProperties?(view: number): string;
  setCoords?(label: string, x: number, y: number): void;
  setVisible?(label: string, visible: boolean): void;
  setAuxiliary?(label: string, auxiliary: boolean): void;
  setFixed?(label: string, fixed: boolean, selectionAllowed: boolean): void;
  getXML?(label?: string): string;
  setXML?(xml: string): void;
  setUndoPoint?(): void;
  getBase64?(callback: (base64: string) => void): void;
  setBase64?(base64: string, callback: () => void): void;
}

export interface ManagedText extends ManagedDocument {
  id: string;
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

  async start(): Promise<void> {
    const generation = ++this.generation;
    this.api?.remove?.();
    this.api = undefined;
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
      return this.api.getAllObjectNames().map((label) => ({
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

  getManagedTexts(): ManagedText[] {
    const api = this.readyApi();
    return Object.entries(this.metadata().envelope.documents)
      .filter(
        ([, document]) => api.getObjectType?.(document.targetLabel) === "text",
      )
      .map(([id, document]) => ({ id, ...document }));
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
    const api = this.readyApi();
    const metadata = this.metadata();
    const document = metadata.envelope.documents[id];
    if (!document || api.getObjectType?.(document.targetLabel) !== "text")
      throw new Error("Editing Target no longer exists.");
    const snapshot = api.getXML?.();
    if (!snapshot || !api.setXML || !metadata.label)
      throw new Error("GeoGebra cannot snapshot the Applied Source state.");
    const presentation = api.getXML?.(document.targetLabel);
    const presentationElement = presentation?.includes("<element")
      ? presentation.slice(presentation.indexOf("<element"))
      : undefined;
    const presentationMatches = () => {
      const current = api.getXML?.(document.targetLabel);
      return (
        !!presentationElement &&
        !!current &&
        current.slice(current.indexOf("<element")) === presentationElement
      );
    };
    if (!presentationMatches())
      throw new Error(
        "GeoGebra cannot snapshot the Editing Target presentation.",
      );
    const previousCommand = api.getCommandString?.(document.targetLabel, false);
    const previousMetadata = String(api.getValueString?.(metadata.label) ?? "");
    const previousExpression = compileSource(document.source, {
      simplify: document.simplify,
      symbols: this.getSymbols(),
    }).expression;
    try {
      // Observe GeoGebra's normalized command before writing its fingerprint.
      // Restore the snapshot so the final target/metadata write is one operation.
      api.evalCommand?.(`${document.targetLabel}=${expression}`);
      if (api.getObjectType?.(document.targetLabel) !== "text")
        throw new Error("GeoGebra did not retain the Editing Target.");
      const stagedCommand = api.getCommandString?.(document.targetLabel, false);
      if (
        !stagedCommand ||
        (stagedCommand === previousCommand && expression !== previousExpression)
      )
        throw new Error("GeoGebra rejected the Compiled Definition.");
      if (!presentationMatches())
        throw new Error("GeoGebra changed the Editing Target presentation.");
      const updated: ManagedDocument = {
        targetLabel: document.targetLabel,
        source,
        simplify,
        compiledFingerprint: await this.fingerprint(document.targetLabel),
      };
      metadata.envelope.documents[id] = updated;
      const encoded = encodeMetadata(metadata.envelope);
      api.setXML(snapshot);
      if (
        api.getCommandString?.(document.targetLabel, false) !==
          previousCommand ||
        String(api.getValueString?.(metadata.label) ?? "") !==
          previousMetadata ||
        !presentationMatches()
      )
        throw new Error("GeoGebra did not restore the pre-Apply state.");
      api.evalCommand?.(
        `${document.targetLabel}=${expression}\n${metadata.label}="${encoded}"`,
      );
      if (
        api.getObjectType?.(document.targetLabel) !== "text" ||
        api.getCommandString?.(document.targetLabel, false) !== stagedCommand
      )
        throw new Error("GeoGebra did not retain the Compiled Definition.");
      if (String(api.getValueString?.(metadata.label) ?? "") !== encoded)
        throw new Error("Metadata verification failed.");
      api.setVisible?.(metadata.label, false);
      api.setAuxiliary?.(metadata.label, true);
      api.setFixed?.(metadata.label, true, false);
      if (!presentationMatches())
        throw new Error("GeoGebra changed the Editing Target presentation.");
      api.setUndoPoint?.();
      return { id, ...updated };
    } catch (error) {
      api.setXML(snapshot);
      if (
        api.getCommandString?.(document.targetLabel, false) !==
          previousCommand ||
        String(api.getValueString?.(metadata.label) ?? "") !==
          previousMetadata ||
        !presentationMatches()
      )
        throw new Error("Apply rollback failed.", { cause: error });
      throw error;
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
