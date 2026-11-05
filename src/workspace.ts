import { compileSource, type CompileResult, type SymbolInfo } from "./compiler";

/** Draft-only workspace slice. Applying and target persistence belong to later tickets. */
export class AuthoringWorkspace {
  private source = "";
  private simplify = true;
  private symbols: readonly SymbolInfo[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private compiled = compileSource("", { simplify: true, symbols: [] });

  constructor(private readonly notify: (result: CompileResult) => void) {}

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
