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
