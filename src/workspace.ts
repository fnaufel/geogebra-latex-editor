import { compileSource, type CompileResult, type SymbolInfo } from "./compiler";
import type { ManagedText } from "./geogebra";

export interface WorkspaceAdapter {
  getSymbols(): SymbolInfo[];
  createManagedText(): Promise<ManagedText>;
  applyManagedText(
    id: string,
    source: string,
    simplify: boolean,
    expression: string,
  ): Promise<ManagedText>;
  importBase64(base64: string): Promise<void>;
  getManagedTexts(): ManagedText[];
  exportBase64(): Promise<string>;
}

export class AuthoringWorkspace {
  private source = "";
  private simplify = true;
  private symbols: readonly SymbolInfo[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private compiled = compileSource("", { simplify: true, symbols: [] });
  private editingTarget: ManagedText | null = null;

  constructor(
    private readonly notify: (result: CompileResult) => void,
    private readonly adapter?: WorkspaceAdapter,
  ) {}

  get target(): ManagedText | null {
    return this.editingTarget;
  }

  get currentSource(): string {
    return this.source;
  }

  get currentSimplify(): boolean {
    return this.simplify;
  }

  get hasDraft(): boolean {
    return (
      this.editingTarget !== null &&
      (this.source !== this.editingTarget.source ||
        this.simplify !== this.editingTarget.simplify)
    );
  }

  private loadTarget(target: ManagedText | null): void {
    this.editingTarget = target;
    this.source = target?.source ?? "";
    this.simplify = target?.simplify ?? true;
    this.symbols = this.adapter?.getSymbols() ?? this.symbols;
    this.validateNow();
  }

  async create(): Promise<ManagedText> {
    if (!this.adapter) throw new Error("GeoGebra adapter is unavailable.");
    const target = await this.adapter.createManagedText();
    this.loadTarget(target);
    return target;
  }

  async apply(): Promise<ManagedText> {
    if (!this.adapter || !this.editingTarget)
      throw new Error("No Editing Target.");
    this.symbols = this.adapter.getSymbols();
    const result = this.validateNow();
    if (!result.expression)
      throw new Error("Correct the Authoring Source errors before Apply.");
    const target = await this.adapter.applyManagedText(
      this.editingTarget.id,
      this.source,
      this.simplify,
      result.expression,
    );
    this.editingTarget = target;
    return target;
  }

  async open(base64: string): Promise<ManagedText | null> {
    if (!this.adapter) throw new Error("GeoGebra adapter is unavailable.");
    await this.adapter.importBase64(base64);
    const target = this.adapter.getManagedTexts()[0] ?? null;
    this.loadTarget(target);
    return target;
  }

  async exportBase64(): Promise<string> {
    if (!this.adapter) throw new Error("GeoGebra adapter is unavailable.");
    return this.adapter.exportBase64();
  }

  get result(): CompileResult {
    return this.compiled;
  }

  get currentSymbols(): readonly SymbolInfo[] {
    return this.symbols;
  }

  setSource(source: string): void {
    this.source = source;
    this.schedule();
  }

  setSimplify(simplify: boolean): void {
    this.simplify = simplify;
    this.schedule();
  }

  setSymbols(symbols: readonly SymbolInfo[]): void {
    this.symbols = symbols;
    this.schedule();
  }

  validateNow(): CompileResult {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.compiled = compileSource(this.source, {
      simplify: this.simplify,
      symbols: this.symbols,
    });
    this.notify(this.compiled);
    return this.compiled;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.validateNow(), 300);
  }
}
