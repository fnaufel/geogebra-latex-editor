import { compileSource, type CompileResult, type SymbolInfo } from "./compiler";
import {
  ApplyFailure,
  type ConstructionEvent,
  type ManagedText,
} from "./geogebra";

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
  onEvent?(listener: (event: ConstructionEvent) => void): () => void;
}

export class AuthoringWorkspace {
  private source = "";
  private simplify = true;
  private symbols: readonly SymbolInfo[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private compiled = compileSource("", { simplify: true, symbols: [] });
  private editingTarget: ManagedText | null = null;
  private selected: readonly SymbolInfo[] = [];
  private readonly drafts = new Map<
    string,
    { source: string; simplify: boolean }
  >();
  private readonly draftBaselines = new Map<
    string,
    Pick<ManagedText, "source" | "simplify" | "compiledFingerprint">
  >();
  private resyncTimer: ReturnType<typeof setTimeout> | undefined;
  private insertionRange: { from: number; to: number } | null = null;
  private insertionQueued = false;
  private insertionGeneration = 0;
  private unsubscribe?: () => void;
  private message = "";

  constructor(
    private readonly notify: (result: CompileResult) => void,
    private readonly adapter?: WorkspaceAdapter,
    private readonly onInsertion?: (
      from: number,
      to: number,
      text: string,
    ) => void,
  ) {
    this.unsubscribe = adapter?.onEvent?.((event) => this.handleEvent(event));
  }

  get selectionMessage(): string {
    if (this.selected.length === 0)
      return "Select one text object in GeoGebra, then choose Edit selected text.";
    if (this.selected.length > 1)
      return "Select exactly one text object to edit.";
    if (this.selected[0]?.type !== "text")
      return "The selected object is not a text object.";
    if (!this.canEditSelection)
      return `${this.selected[0]!.label} is an Unmanaged Text Object. Authoring Source is unavailable until Adoption.`;
    return `Selected text: ${this.selected[0]!.label}. Choose Edit selected text to pin it.`;
  }

  get canEditSelection(): boolean {
    return (
      this.selected.length === 1 &&
      this.selected[0]?.type === "text" &&
      !!this.adapter
        ?.getManagedTexts()
        .some((text) => text.targetLabel === this.selected[0]?.label)
    );
  }

  get insertionMode(): boolean {
    return this.insertionRange !== null;
  }

  get interactionMessage(): string {
    return this.message;
  }

  editSelectedText(): boolean {
    if (!this.canEditSelection || !this.adapter) return false;
    const label = this.selected[0]!.label;
    const target = this.adapter
      .getManagedTexts()
      .find((text) => text.targetLabel === label);
    if (!target) {
      this.message = `${label} is an Unmanaged Text Object. Authoring Source is unavailable until Adoption.`;
      this.notify(this.compiled);
      return false;
    }
    this.message = `Editing Target pinned to ${label}.`;
    this.loadTarget(target);
    return true;
  }

  startInsertion(from: number, to: number): void {
    if (!this.editingTarget)
      throw new Error("Choose an Editing Target before inserting an object.");
    if (from < 0 || to < from || to > this.source.length)
      throw new Error("Insertion cursor is outside Draft Source.");
    this.insertionGeneration++;
    this.insertionRange = { from, to };
    this.message = "Insertion Mode: select one GeoGebra object, or cancel.";
    this.notify(this.compiled);
  }

  cancelInsertion(): void {
    if (!this.insertionRange) return;
    this.insertionGeneration++;
    this.insertionRange = null;
    this.message = "Insertion Mode canceled.";
    this.notify(this.compiled);
  }

  private handleEvent(event: ConstructionEvent): void {
    if (event.kind === "selection") {
      this.selected = event.selected;
      if (this.insertionRange) {
        if (this.selected.length > 1) {
          this.message = "Select exactly one object for insertion.";
        } else if (this.selected.length === 1 && !this.insertionQueued) {
          this.insertionQueued = true;
          const generation = this.insertionGeneration;
          queueMicrotask(() => {
            this.insertionQueued = false;
            if (
              !this.insertionRange ||
              generation !== this.insertionGeneration ||
              this.selected.length !== 1
            )
              return;
            const label = this.selected[0]!.label;
            const { from, to } = this.insertionRange;
            const text = `@${label}@`;
            this.insertionRange = null;
            this.source =
              this.source.slice(0, from) + text + this.source.slice(to);
            this.drafts.set(this.editingTarget!.id, {
              source: this.source,
              simplify: this.simplify,
            });
            this.message = `Inserted ${label} into Draft Source.`;
            this.onInsertion?.(from, to, text);
            this.validateNow();
          });
        }
      }
      this.notify(this.compiled);
      return;
    }
    if (
      event.kind === "object" ||
      event.kind === "rename" ||
      event.kind === "clear" ||
      event.kind === "undo" ||
      event.kind === "redo"
    ) {
      this.symbols = this.adapter?.getSymbols() ?? this.symbols;
      if (this.resyncTimer) clearTimeout(this.resyncTimer);
      this.resyncTimer = setTimeout(() => {
        this.resyncTimer = undefined;
        this.resynchronize();
      }, 0);
    }
  }

  private resynchronize(): void {
    const current = this.editingTarget;
    const applied = this.adapter
      ?.getManagedTexts()
      .find((text) => text.id === current?.id);
    if (current && applied) {
      const dirty = this.hasDraft;
      this.editingTarget = applied;
      if (!dirty) {
        this.source = applied.source;
        this.simplify = applied.simplify;
        this.drafts.set(applied.id, {
          source: applied.source,
          simplify: applied.simplify,
        });
        this.draftBaselines.delete(applied.id);
      }
    }
    this.symbols = this.adapter?.getSymbols() ?? this.symbols;
    this.validateNow();
  }

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

  get diverged(): boolean {
    if (!this.editingTarget || !this.hasDraft) return false;
    const baseline = this.draftBaselines.get(this.editingTarget.id);
    return (
      baseline !== undefined &&
      (baseline.source !== this.editingTarget.source ||
        baseline.simplify !== this.editingTarget.simplify ||
        baseline.compiledFingerprint !== this.editingTarget.compiledFingerprint)
    );
  }

  discardDraft(): void {
    if (!this.editingTarget) return;
    this.source = this.editingTarget.source;
    this.simplify = this.editingTarget.simplify;
    this.drafts.delete(this.editingTarget.id);
    this.draftBaselines.delete(this.editingTarget.id);
    this.validateNow();
  }

  get hasAnyDraft(): boolean {
    const applied = new Map(
      this.adapter?.getManagedTexts().map((text) => [text.id, text]) ?? [],
    );
    return [...this.drafts].some(([id, draft]) => {
      const text = applied.get(id);
      return (
        !!text &&
        (draft.source !== text.source || draft.simplify !== text.simplify)
      );
    });
  }

  private loadTarget(target: ManagedText | null): void {
    this.insertionGeneration++;
    this.insertionRange = null;
    if (this.editingTarget)
      this.drafts.set(this.editingTarget.id, {
        source: this.source,
        simplify: this.simplify,
      });
    this.editingTarget = target;
    const draft = target && this.drafts.get(target.id);
    this.source = draft?.source ?? target?.source ?? "";
    this.simplify = draft?.simplify ?? target?.simplify ?? true;
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
      throw new ApplyFailure(
        "APPLY_COMPILER_REJECTED",
        "Correct the Authoring Source errors before Apply.",
      );
    const target = await this.adapter.applyManagedText(
      this.editingTarget.id,
      this.source,
      this.simplify,
      result.expression,
    );
    this.editingTarget = target;
    this.drafts.set(target.id, {
      source: target.source,
      simplify: target.simplify,
    });
    this.draftBaselines.delete(target.id);
    return target;
  }

  async open(base64: string): Promise<ManagedText | null> {
    if (!this.adapter) throw new Error("GeoGebra adapter is unavailable.");
    await this.adapter.importBase64(base64);
    this.drafts.clear();
    this.draftBaselines.clear();
    this.editingTarget = null;
    this.insertionRange = null;
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

  private rememberDraftBaseline(): void {
    if (this.editingTarget && !this.hasDraft)
      this.draftBaselines.set(this.editingTarget.id, {
        source: this.editingTarget.source,
        simplify: this.editingTarget.simplify,
        compiledFingerprint: this.editingTarget.compiledFingerprint,
      });
  }

  setSource(source: string): void {
    this.rememberDraftBaseline();
    this.source = source;
    if (this.editingTarget)
      this.drafts.set(this.editingTarget.id, {
        source,
        simplify: this.simplify,
      });
    this.schedule();
  }

  setSimplify(simplify: boolean): void {
    this.rememberDraftBaseline();
    this.simplify = simplify;
    if (this.editingTarget)
      this.drafts.set(this.editingTarget.id, { source: this.source, simplify });
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
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    this.unsubscribe?.();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.validateNow(), 300);
  }
}
