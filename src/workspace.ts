import {
  compileSource,
  rewriteGlobalReferences,
  type CompileResult,
  type SourceRange,
  type SymbolInfo,
} from "./compiler";
import {
  ApplyFailure,
  type ConstructionEvent,
  type ManagedText,
  type OrphanedText,
} from "./geogebra";
import {
  DiagnosticHistory,
  failureNotice,
  metadataNotice,
  type FailurePhase,
} from "./diagnostics";
import {
  clearFailedApplyRecovery,
  readFailedApplyRecovery,
  saveFailedApplyRecovery,
  type FailedApplyRecovery,
} from "./failed-apply-recovery";
import {
  clearLocalRecoveryData,
  constructionFingerprint as fingerprintConstruction,
  listRecoveryRecords,
  measureLocalRecoveryData,
  removeRecoveryRecord,
  saveRecoveryRecord,
  stageRecoveryRecord,
  TabPresence,
  unstageRecoveryRecord,
  type RecoveryDraft,
  type RecoveryRecord,
} from "./recovery";

export interface WorkspaceAdapter {
  getSymbols(): SymbolInfo[];
  getUnmanagedTextSnapshot(label: string): string;
  adoptUnmanagedText(
    label: string,
    expectedRenderedLatex: string,
  ): Promise<ManagedText>;
  createManagedText(): Promise<ManagedText>;
  applyManagedText(
    id: string,
    source: string,
    simplify: boolean,
    expression: string,
  ): Promise<ManagedText>;
  importBase64(base64: string, canCommit?: () => boolean): Promise<void>;
  newConstruction?(): Promise<void>;
  getConstructionState?(): string;
  getManagedTexts(): ManagedText[];
  getOrphanedTexts?(): OrphanedText[];
  discardOrphanedText?(id: string): Promise<void>;
  restoreOrphanedText?(
    id: string,
    source: string,
    simplify: boolean,
  ): Promise<ManagedText>;
  reconcileMetadata?(allowRecovery?: boolean): Promise<void>;
  exportBase64(): Promise<string>;
  onEvent?(listener: (event: ConstructionEvent) => void): () => void;
  readonly recoverableApplySnapshot?: string | null;
  restoreApplySnapshot?(snapshot: string): void | Promise<void>;
}

export class AuthoringWorkspace {
  private source = "";
  private simplify = true;
  private symbols: readonly SymbolInfo[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private compiled = compileSource("", { simplify: true, symbols: [] });
  private editingTarget: ManagedText | null = null;
  private unmanaged: {
    label: string;
    renderedLatex: string;
    formerManagedId?: string;
  } | null = null;
  private orphaned: OrphanedText | null = null;
  private readonly retainedOrphans = new Map<string, OrphanedText>();
  private readonly recoveredOrphanIds = new Set<string>();
  private selected: readonly SymbolInfo[] = [];
  private readonly drafts = new Map<
    string,
    { source: string; simplify: boolean }
  >();
  private readonly draftBaselines = new Map<
    string,
    Pick<ManagedText, "source" | "simplify" | "compiledFingerprint">
  >();
  private readonly undoneAdoptions = new Map<string, string>();
  private resyncTimer: ReturnType<typeof setTimeout> | undefined;
  private renamePending = false;
  private historyPending = false;
  private historyAction: "undo" | "redo" | null = null;
  private historySymbolsBefore: readonly SymbolInfo[] | null = null;
  private readonly recentRenames: { oldLabel: string; label: string }[] = [];
  private manualRenameRanges: SourceRange[] = [];
  private insertionRange: { from: number; to: number } | null = null;
  private insertionQueued = false;
  private insertionGeneration = 0;
  private unsubscribe?: () => void;
  private message = "";
  private actionErrorMessage: string | null = null;
  private readonly diagnosticHistory = new DiagnosticHistory();
  private recoveryRecord: FailedApplyRecovery | null = null;
  private readonly recoveryLoad: Promise<void>;
  private cleanConstructionState: string | null = null;
  private constructionChanged = false;
  private workspaceId = crypto.randomUUID();
  private constructionFingerprint: string | null = null;
  private recoveryRecords: RecoveryRecord[] = [];
  private startupRecovery = true;
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private recoveryGeneration = 0;
  private recoveryWrite: Promise<void> = Promise.resolve();
  private lastSnapshot: string | null = null;
  private stagedRecoveryKey: string | null = null;
  private activeRecoveryKey: string | null = null;
  private concurrentWork = false;
  private recoveryStorageUnavailable = false;
  private readonly presence = new TabPresence((concurrent) => {
    this.concurrentWork = concurrent;
    this.notify(this.compiled);
  });

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
    this.recoveryLoad = readFailedApplyRecovery()
      .then((recovery) => {
        this.recoveryRecord = recovery;
        this.notify(this.compiled);
      })
      .catch(() => {});
    void this.refreshRecoveryRecords();
  }

  get recoveryCandidates(): RecoveryRecord[] {
    return this.recoveryRecords.filter(
      (record) =>
        record.workspaceId !== this.workspaceId &&
        (this.constructionFingerprint
          ? record.constructionFingerprint === this.constructionFingerprint
          : this.startupRecovery && record.snapshot.length > 0),
    );
  }

  get concurrentTabWarning(): boolean {
    return this.concurrentWork;
  }

  async refreshRecoveryRecords(): Promise<void> {
    try {
      this.recoveryRecords = await listRecoveryRecords();
      this.notify(this.compiled);
    } catch {
      // Private browsing may disable IndexedDB; the editor remains usable.
    }
  }

  async clearLocalRecovery(): Promise<{ records: number; bytes: number }> {
    this.recoveryGeneration++;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    await this.recoveryWrite;
    await this.recoveryLoad;
    const removed = await clearLocalRecoveryData();
    this.recoveryRecords = [];
    this.recoveryRecord = null;
    this.activeRecoveryKey = null;
    this.stagedRecoveryKey = null;
    this.notify(this.compiled);
    return removed;
  }

  async localRecoverySize(): Promise<{ records: number; bytes: number }> {
    await this.recoveryWrite;
    return measureLocalRecoveryData();
  }

  async discardRecovery(key: string): Promise<void> {
    await removeRecoveryRecord(key);
    await this.refreshRecoveryRecords();
  }

  async restoreRecovery(key: string, useSnapshot: boolean): Promise<void> {
    const record = this.recoveryRecords.find(
      (candidate) => candidate.key === key,
    );
    if (!record) throw new Error("Recovery Draft is no longer available.");
    if (
      !useSnapshot &&
      (!this.constructionFingerprint ||
        record.constructionFingerprint !== this.constructionFingerprint)
    )
      throw new Error(
        "This Recovery Draft belongs to a different construction.",
      );
    if (useSnapshot) {
      await this.open(record.snapshot);
      this.constructionFingerprint = record.constructionFingerprint;
      this.presence.setFingerprint(this.constructionFingerprint);
      this.startupRecovery = false;
      if (record.dirtyConstruction) {
        this.cleanConstructionState = null;
        this.constructionChanged = true;
      }
    }
    const managed = this.adapter?.getManagedTexts() ?? [];
    let firstTarget: ManagedText | undefined;
    let hasOrphan = false;
    let hasDivergedDraft = false;
    for (const draft of record.drafts) {
      const byId = managed.find((text) => text.id === draft.id);
      const matches = managed.filter(
        (text) =>
          text.compiledFingerprint === draft.baseline.compiledFingerprint &&
          text.source === draft.baseline.source &&
          text.simplify === draft.baseline.simplify,
      );
      const target = byId ?? (matches.length === 1 ? matches[0] : undefined);
      if (target) {
        firstTarget ??= target;
        hasDivergedDraft ||=
          target.source !== draft.baseline.source ||
          target.simplify !== draft.baseline.simplify ||
          target.compiledFingerprint !== draft.baseline.compiledFingerprint;
        this.drafts.set(target.id, {
          source: draft.source,
          simplify: draft.simplify,
        });
        this.draftBaselines.set(target.id, draft.baseline);
      } else {
        hasOrphan = true;
        this.recoveredOrphanIds.add(draft.id);
        this.retainedOrphans.set(draft.id, {
          id: draft.id,
          targetLabel: draft.targetLabel,
          source: draft.baseline.source,
          simplify: draft.baseline.simplify,
          compiledFingerprint: draft.baseline.compiledFingerprint,
          candidates: matches.map((text) => text.targetLabel),
        });
        this.drafts.set(draft.id, {
          source: draft.source,
          simplify: draft.simplify,
        });
      }
    }
    const first = record.drafts[0];
    if (firstTarget) {
      this.editingTarget = null;
      this.loadTarget(firstTarget);
    } else if (first) this.openOrphaned(first.id);
    this.message = `Recovery Draft restored locally and ${hasDivergedDraft ? "diverges from" : "matches"} the construction snapshot's Applied Source baseline. Review before Apply.${hasOrphan ? " Orphaned Source remains because an Editing Target could not be identified safely; restore it explicitly as new text." : ""}`;
    await removeRecoveryRecord(key);
    await this.refreshRecoveryRecords();
    this.scheduleRecovery();
    this.validateNow();
  }

  private scheduleRecovery(captureSnapshot = false): void {
    this.recoveryGeneration++;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.stageRecovery();
    const generation = this.recoveryGeneration;
    const snapshot = captureSnapshot ? this.adapter?.exportBase64() : undefined;
    if (snapshot)
      void snapshot
        .then((base64) => {
          if (generation !== this.recoveryGeneration) return;
          this.lastSnapshot = base64;
          this.stageRecovery();
        })
        .catch(() => {});
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      this.recoveryWrite = this.recoveryWrite
        .then(() => this.persistRecovery(generation, snapshot))
        .catch(() => {});
    }, 0);
  }

  private recoveryDrafts(): RecoveryDraft[] {
    const applied = new Map(
      this.adapter?.getManagedTexts().map((text) => [text.id, text]) ?? [],
    );
    return [...this.drafts].flatMap(([id, draft]) => {
      const baseline =
        this.draftBaselines.get(id) ??
        applied.get(id) ??
        this.retainedOrphans.get(id);
      if (!baseline) return [];
      return [
        {
          id,
          targetLabel:
            applied.get(id)?.targetLabel ??
            this.retainedOrphans.get(id)?.targetLabel ??
            (this.orphaned?.id === id
              ? this.orphaned.targetLabel
              : undefined) ??
            id,
          source: draft.source,
          simplify: draft.simplify,
          baseline: {
            source: baseline.source,
            simplify: baseline.simplify,
            compiledFingerprint: baseline.compiledFingerprint,
          },
        },
      ];
    });
  }

  private stageRecovery(): void {
    const key = `${this.constructionFingerprint ?? "unsaved"}:${this.workspaceId}`;
    if (this.stagedRecoveryKey && this.stagedRecoveryKey !== key)
      unstageRecoveryRecord(this.stagedRecoveryKey);
    if (!this.lastSnapshot || (!this.hasAnyDraft && !this.dirtyConstruction)) {
      unstageRecoveryRecord(key);
      this.stagedRecoveryKey = null;
      return;
    }
    stageRecoveryRecord({
      key,
      workspaceId: this.workspaceId,
      constructionFingerprint: this.constructionFingerprint,
      snapshot: this.lastSnapshot,
      drafts: this.recoveryDrafts(),
      dirtyConstruction: this.dirtyConstruction,
      savedAt: Date.now(),
    });
    this.stagedRecoveryKey = key;
  }

  private async persistRecovery(
    generation: number,
    pendingSnapshot?: Promise<string>,
  ): Promise<void> {
    if (!this.adapter || generation !== this.recoveryGeneration) return;
    const key = `${this.constructionFingerprint ?? "unsaved"}:${this.workspaceId}`;
    if (!this.hasAnyDraft && !this.dirtyConstruction) {
      if (this.activeRecoveryKey)
        await removeRecoveryRecord(this.activeRecoveryKey);
      this.activeRecoveryKey = null;
      await this.refreshRecoveryRecords();
      return;
    }
    try {
      const snapshot = await (pendingSnapshot ?? this.adapter.exportBase64());
      if (generation !== this.recoveryGeneration) return;
      this.lastSnapshot = snapshot;
      this.stageRecovery();
      await saveRecoveryRecord({
        key,
        workspaceId: this.workspaceId,
        constructionFingerprint: this.constructionFingerprint,
        snapshot,
        drafts: this.recoveryDrafts(),
        dirtyConstruction: this.dirtyConstruction,
        savedAt: Date.now(),
      });
      if (this.activeRecoveryKey && this.activeRecoveryKey !== key)
        await removeRecoveryRecord(this.activeRecoveryKey);
      this.activeRecoveryKey = key;
      this.recoveryStorageUnavailable = false;
      await this.refreshRecoveryRecords();
    } catch {
      this.recoveryStorageUnavailable = true;
      this.notify(this.compiled);
    }
  }

  get selectionMessage(): string {
    if (this.selected.length === 0)
      return "Select one text object in GeoGebra, then choose Edit selected text.";
    if (this.selected.length > 1)
      return "Select exactly one text object to edit.";
    if (this.selected[0]?.type !== "text")
      return "The selected object is not a text object.";
    return `Selected text: ${this.selected[0]!.label}. Choose Edit selected text to pin it.`;
  }

  get canEditSelection(): boolean {
    return (
      this.selected.length === 1 &&
      this.selected[0]?.type === "text" &&
      !!this.adapter
    );
  }

  get insertionMode(): boolean {
    return this.insertionRange !== null;
  }

  get interactionMessage(): string {
    return this.recoveryStorageUnavailable
      ? `${this.message} Local recovery storage is unavailable. Download the construction to keep your work.`.trim()
      : this.message;
  }

  get actionError(): string | null {
    return this.actionErrorMessage;
  }

  recordDiagnostic(phase: FailurePhase, code: string): void {
    this.diagnosticHistory.record(phase, code);
  }

  diagnosticReport(userAgent: string): string {
    return this.diagnosticHistory.report(userAgent);
  }

  get recoveryAvailable(): boolean {
    return this.recoveryRecord !== null;
  }

  async reportActionError(
    error: unknown,
    recoverableSnapshot: boolean,
    phase: FailurePhase = "transaction",
  ): Promise<void> {
    const notice = failureNotice(error, phase);
    this.recordDiagnostic(
      notice.phase,
      error instanceof ApplyFailure ? error.code : notice.code,
    );
    if (error instanceof ApplyFailure && error.reason)
      this.recordDiagnostic(notice.phase, error.reason);
    this.actionErrorMessage = `[${notice.code}] ${notice.message}${recoverableSnapshot && error instanceof ApplyFailure && error.code !== "APPLY_ROLLBACK_FAILED" ? " Download the current construction if possible, then reload before applying again." : ""}`;
    if (
      error instanceof ApplyFailure &&
      error.code === "APPLY_ROLLBACK_FAILED" &&
      this.editingTarget &&
      this.adapter?.recoverableApplySnapshot
    ) {
      const recovery = {
        snapshot: this.adapter.recoverableApplySnapshot,
        id: this.editingTarget.id,
        source: this.source,
        simplify: this.simplify,
      };
      try {
        await this.recoveryLoad;
        this.recoveryRecord = await saveFailedApplyRecovery(recovery);
      } catch {
        this.actionErrorMessage +=
          " Local recovery storage is unavailable; download the current construction before reloading.";
      }
    }
    this.notify(this.compiled);
  }

  async recoverFailedApply(): Promise<void> {
    await this.recoveryLoad;
    const recovery = this.recoveryRecord;
    if (!recovery || !this.adapter?.restoreApplySnapshot)
      throw new Error("Failed Apply recovery is unavailable.");
    await this.adapter.restoreApplySnapshot(recovery.snapshot);
    const target = this.adapter
      .getManagedTexts()
      .find((text) => text.id === recovery.id);
    if (!target)
      throw new Error("The recovered Editing Target is unavailable.");
    this.drafts.clear();
    this.draftBaselines.clear();
    this.undoneAdoptions.clear();
    this.editingTarget = null;
    this.loadTarget(target);
    this.setSource(recovery.source);
    this.setSimplify(recovery.simplify);
    this.validateNow();
    await clearFailedApplyRecovery(recovery);
    this.recoveryRecord = null;
    this.clearActionError();
  }

  clearActionError(): void {
    if (this.actionErrorMessage === null) return;
    this.actionErrorMessage = null;
    this.notify(this.compiled);
  }

  editSelectedText(): boolean {
    if (!this.canEditSelection || !this.adapter) return false;
    const label = this.selected[0]!.label;
    const target = this.adapter
      .getManagedTexts()
      .find((text) => text.targetLabel === label);
    if (!target) {
      const renderedLatex = this.adapter.getUnmanagedTextSnapshot(label);
      this.loadTarget(null);
      this.unmanaged = {
        label,
        renderedLatex,
        formerManagedId: this.undoneAdoptions.get(label),
      };
      this.message = `${label} is an Unmanaged Text Object. Adoption requires confirmation.`;
      this.notify(this.compiled);
      return true;
    }
    this.undoneAdoptions.delete(label);
    this.message = `Editing Target pinned to ${label}.`;
    this.loadTarget(target);
    return true;
  }

  async adopt(confirmed: boolean): Promise<ManagedText> {
    if (!confirmed || !this.adapter || !this.unmanaged)
      throw new Error("Confirm Adoption of an Unmanaged Text Object first.");
    const { label, renderedLatex, formerManagedId } = this.unmanaged;
    const retainedDraft = formerManagedId
      ? this.drafts.get(formerManagedId)
      : undefined;
    const target = await this.adapter.adoptUnmanagedText(label, renderedLatex);
    this.clearActionError();
    if (formerManagedId && retainedDraft) {
      this.drafts.delete(formerManagedId);
      this.draftBaselines.delete(formerManagedId);
    }
    this.undoneAdoptions.delete(label);
    this.loadTarget(target);
    if (retainedDraft) {
      this.setSource(retainedDraft.source);
      this.setSimplify(retainedDraft.simplify);
      this.validateNow();
    }
    this.message = `Adopted ${label} as a Managed Text Object.`;
    this.notify(this.compiled);
    return target;
  }

  async restoreOrphaned(): Promise<ManagedText> {
    if (!this.canRestoreOrphaned || !this.orphaned || !this.adapter)
      throw new Error("No Orphaned Source is available for restoration.");
    const oldId = this.orphaned.id;
    const desiredSource = this.source;
    const desiredSimplify = this.simplify;
    let target: ManagedText;
    if (this.recoveredOrphanIds.has(oldId)) {
      const result = this.validateNow();
      if (!result.expression)
        throw new Error(
          "Correct the recovered Authoring Source before restoring it.",
        );
      const created = await this.adapter.createManagedText();
      target = await this.adapter.applyManagedText(
        created.id,
        this.source,
        this.simplify,
        result.expression,
      );
    } else {
      if (!this.adapter.restoreOrphanedText)
        throw new Error("GeoGebra cannot restore this Orphaned Source.");
      target = await this.adapter.restoreOrphanedText(
        oldId,
        this.source,
        this.simplify,
      );
    }
    this.retainedOrphans.delete(oldId);
    this.recoveredOrphanIds.delete(oldId);
    this.drafts.delete(oldId);
    this.draftBaselines.delete(oldId);
    this.orphaned = null;
    this.loadTarget(target);
    if (this.source !== desiredSource) this.setSource(desiredSource);
    if (this.simplify !== desiredSimplify) this.setSimplify(desiredSimplify);
    this.scheduleRecovery();
    this.message = `Orphaned Source restored as ${target.targetLabel}.`;
    this.notify(this.compiled);
    return target;
  }

  get availableOrphans(): OrphanedText[] {
    const orphans = new Map(
      this.adapter?.getOrphanedTexts?.().map((text) => [text.id, text]) ?? [],
    );
    for (const [id, text] of this.retainedOrphans) orphans.set(id, text);
    if (this.orphaned) orphans.set(this.orphaned.id, this.orphaned);
    return [...orphans.values()];
  }

  openOrphaned(id: string): void {
    const orphan = this.availableOrphans.find((text) => text.id === id);
    if (!orphan) throw new Error("Orphaned Source is no longer available.");
    this.loadTarget(null);
    this.orphaned = orphan;
    const draft = this.drafts.get(id);
    this.source = draft?.source ?? orphan.source;
    this.simplify = draft?.simplify ?? orphan.simplify;
    this.message = `Orphaned Source for ${orphan.targetLabel} is open.`;
    this.validateNow();
  }

  async discardOrphaned(): Promise<void> {
    const orphan = this.orphaned;
    if (!orphan) throw new Error("No Orphaned Source is open.");
    if (
      !this.recoveredOrphanIds.has(orphan.id) &&
      this.canRestoreOrphaned &&
      this.adapter
    ) {
      if (!this.adapter.discardOrphanedText)
        throw new Error("GeoGebra cannot discard this Orphaned Source.");
      await this.adapter.discardOrphanedText(orphan.id);
    }
    this.retainedOrphans.delete(orphan.id);
    this.recoveredOrphanIds.delete(orphan.id);
    this.drafts.delete(orphan.id);
    this.draftBaselines.delete(orphan.id);
    this.orphaned = null;
    this.source = "";
    this.simplify = true;
    this.message = `Orphaned Source for ${orphan.targetLabel} was discarded.`;
    this.scheduleRecovery();
    this.validateNow();
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

  private rewriteRetainedReferences(
    oldLabel: string,
    label: string,
    symbols: readonly SymbolInfo[],
  ): void {
    for (const [id, draft] of this.drafts) {
      const rewritten = rewriteGlobalReferences(
        draft.source,
        oldLabel,
        label,
        symbols,
      );
      this.drafts.set(id, { ...draft, source: rewritten.source });
      if (this.editingTarget?.id === id || this.orphaned?.id === id) {
        this.source = rewritten.source;
        this.manualRenameRanges = rewritten.ambiguous;
      }
    }
    for (const [id, baseline] of this.draftBaselines)
      this.draftBaselines.set(id, {
        ...baseline,
        source: rewriteGlobalReferences(
          baseline.source,
          oldLabel,
          label,
          symbols,
        ).source,
      });
  }

  private handleEvent(event: ConstructionEvent): void {
    if (event.kind === "metadata-error") {
      const notice = metadataNotice(event.message);
      this.recordDiagnostic(notice.phase, notice.code);
      this.actionErrorMessage = `[${notice.code}] ${notice.message}`;
      this.notify(this.compiled);
      return;
    }
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
    if (event.kind === "rename") {
      const afterSymbols = this.adapter?.getSymbols() ?? this.symbols;
      const renamed = afterSymbols.find(
        (symbol) => symbol.label === event.label,
      );
      const oldSymbols = [
        ...afterSymbols.filter((symbol) => symbol.label !== event.label),
        ...(renamed ? [{ ...renamed, label: event.oldLabel }] : []),
      ];
      this.rewriteRetainedReferences(event.oldLabel, event.label, oldSymbols);
      this.recentRenames.push({ oldLabel: event.oldLabel, label: event.label });
      if (this.recentRenames.length > 50) this.recentRenames.shift();
      this.selected = this.selected.map((symbol) =>
        symbol.label === event.oldLabel
          ? { ...symbol, label: event.label }
          : symbol,
      );
      this.renamePending = true;
    }
    if (event.kind === "undo" || event.kind === "redo") {
      this.historyPending = true;
      this.historyAction = event.kind;
      this.historySymbolsBefore ??= this.symbols;
    }
    if (
      event.kind === "object" ||
      event.kind === "rename" ||
      event.kind === "clear" ||
      event.kind === "undo" ||
      event.kind === "redo"
    ) {
      this.constructionChanged = true;
      this.scheduleRecovery(true);
      this.symbols = this.adapter?.getSymbols() ?? this.symbols;
      if (this.resyncTimer) clearTimeout(this.resyncTimer);
      this.resyncTimer = setTimeout(() => {
        this.resyncTimer = undefined;
        void this.resynchronize().catch((error: unknown) => {
          this.recordDiagnostic("metadata", "METADATA_SYNC_FAILED");
          this.actionErrorMessage = `[METADATA_SYNC_FAILED] ${failureNotice(error, "metadata").message}`;
          this.notify(this.compiled);
        });
      }, 0);
    }
  }

  private async resynchronize(): Promise<void> {
    await this.adapter?.reconcileMetadata?.(false);
    const current = this.editingTarget;
    const managed = this.adapter?.getManagedTexts() ?? [];
    for (const [id, orphan] of this.retainedOrphans)
      if (
        managed.some(
          (text) =>
            text.id === id &&
            text.source === orphan.source &&
            text.simplify === orphan.simplify &&
            text.compiledFingerprint === orphan.compiledFingerprint,
        )
      )
        this.retainedOrphans.delete(id);
    if (this.historyAction && this.historySymbolsBefore) {
      const before = new Set(
        this.historySymbolsBefore.map(({ label }) => label),
      );
      const after = new Set(
        (this.adapter?.getSymbols() ?? []).map(({ label }) => label),
      );
      const rename = [...this.recentRenames]
        .reverse()
        .find(({ oldLabel, label }) =>
          this.historyAction === "undo"
            ? before.has(label) &&
              !before.has(oldLabel) &&
              after.has(oldLabel) &&
              !after.has(label)
            : before.has(oldLabel) &&
              !before.has(label) &&
              after.has(label) &&
              !after.has(oldLabel),
        );
      if (rename) {
        const oldLabel =
          this.historyAction === "undo" ? rename.label : rename.oldLabel;
        const label =
          this.historyAction === "undo" ? rename.oldLabel : rename.label;
        this.rewriteRetainedReferences(
          oldLabel,
          label,
          this.historySymbolsBefore,
        );
        for (const [id, baseline] of this.draftBaselines) {
          const applied = managed.find((text) => text.id === id);
          if (
            applied &&
            baseline.source === applied.source &&
            baseline.simplify === applied.simplify
          )
            this.draftBaselines.set(id, {
              ...baseline,
              compiledFingerprint: applied.compiledFingerprint,
            });
        }
        this.selected = this.selected.map((symbol) =>
          symbol.label === oldLabel ? { ...symbol, label } : symbol,
        );
      }
    }
    if (this.orphaned) {
      const oldOrphan = this.orphaned;
      const dirty = this.hasDraft;
      const reattached = managed.find(
        (text) =>
          text.id === this.orphaned?.id &&
          text.source === this.orphaned.source &&
          text.simplify === this.orphaned.simplify &&
          text.compiledFingerprint === this.orphaned.compiledFingerprint,
      );
      if (reattached) {
        this.retainedOrphans.delete(reattached.id);
        this.loadTarget(reattached);
      } else {
        const updated = this.adapter
          ?.getOrphanedTexts?.()
          .find((text) => text.id === oldOrphan.id);
        if (
          updated &&
          (this.renamePending ||
            this.historyPending ||
            (updated.source === oldOrphan.source &&
              updated.simplify === oldOrphan.simplify &&
              updated.compiledFingerprint === oldOrphan.compiledFingerprint))
        ) {
          this.orphaned = updated;
          if (!dirty) {
            this.source = updated.source;
            this.simplify = updated.simplify;
          }
        } else {
          this.retainedOrphans.set(oldOrphan.id, oldOrphan);
          if (updated)
            this.message =
              "Orphaned Source metadata changed externally. Source is retained in this tab; target identity is uncertain.";
        }
      }
    }
    const applied = managed.find((text) => text.id === current?.id);
    const externallyReplaced =
      current &&
      applied &&
      !this.renamePending &&
      !this.historyPending &&
      (current.source !== applied.source ||
        current.simplify !== applied.simplify ||
        current.compiledFingerprint !== applied.compiledFingerprint ||
        current.targetLabel !== applied.targetLabel);
    if (current && applied && !externallyReplaced) {
      const dirty = this.hasDraft;
      this.editingTarget = applied;
      if (this.renamePending) {
        const baseline = this.draftBaselines.get(applied.id);
        if (baseline)
          this.draftBaselines.set(applied.id, {
            ...baseline,
            compiledFingerprint: applied.compiledFingerprint,
          });
      }
      if (!dirty) {
        this.source = applied.source;
        this.simplify = applied.simplify;
        this.drafts.delete(applied.id);
        this.draftBaselines.delete(applied.id);
      }
    } else if (
      current &&
      this.historyPending &&
      this.adapter
        ?.getSymbols()
        .some(
          (symbol) =>
            symbol.label === current.targetLabel && symbol.type === "text",
        )
    ) {
      this.loadTarget(null);
      if (this.drafts.has(current.id))
        this.undoneAdoptions.set(current.targetLabel, current.id);
      this.unmanaged = {
        label: current.targetLabel,
        renderedLatex: this.adapter.getUnmanagedTextSnapshot(
          current.targetLabel,
        ),
        formerManagedId: current.id,
      };
    } else if (current) {
      if (this.hasDraft)
        this.drafts.set(current.id, {
          source: this.source,
          simplify: this.simplify,
        });
      const storedOrphan = this.adapter
        ?.getOrphanedTexts?.()
        .find((text) => text.id === current.id);
      this.orphaned = storedOrphan ?? { ...current, candidates: [] };
      if (!storedOrphan) this.retainedOrphans.set(current.id, this.orphaned);
      this.editingTarget = null;
      this.message =
        externallyReplaced ||
        this.adapter
          ?.getSymbols()
          .some((symbol) => symbol.label === current.targetLabel)
          ? `Authoring Source metadata changed externally. Source is retained in this tab; target identity is uncertain.`
          : `${current.targetLabel} was deleted. Its Authoring Source is retained as Orphaned Source.`;
    } else if (this.unmanaged) {
      const restored = managed.find(
        (text) => text.targetLabel === this.unmanaged?.label,
      );
      if (restored) {
        this.undoneAdoptions.delete(restored.targetLabel);
        this.loadTarget(restored);
      } else if (
        this.adapter
          ?.getSymbols()
          .some(
            (symbol) =>
              symbol.label === this.unmanaged?.label && symbol.type === "text",
          )
      )
        this.unmanaged = {
          label: this.unmanaged.label,
          renderedLatex: this.adapter.getUnmanagedTextSnapshot(
            this.unmanaged.label,
          ),
          formerManagedId: this.unmanaged.formerManagedId,
        };
    }
    this.symbols = this.adapter?.getSymbols() ?? this.symbols;
    this.renamePending = false;
    this.historyPending = false;
    this.historyAction = null;
    this.historySymbolsBefore = null;
    this.validateNow();
  }

  get target(): ManagedText | null {
    return this.editingTarget;
  }

  get orphanedTarget(): OrphanedText | null {
    return this.orphaned;
  }

  get canRestoreOrphaned(): boolean {
    return (
      !!this.orphaned &&
      !!this.adapter &&
      (this.recoveredOrphanIds.has(this.orphaned.id) ||
        !!this.adapter
          .getOrphanedTexts?.()
          .some(
            (text) =>
              text.id === this.orphaned?.id &&
              text.source === this.orphaned.source &&
              text.simplify === this.orphaned.simplify &&
              text.compiledFingerprint === this.orphaned.compiledFingerprint,
          ))
    );
  }

  get unmanagedTarget(): { label: string; renderedLatex: string } | null {
    return this.unmanaged;
  }

  get retainedDraftSource(): string | null {
    const formerId = this.unmanaged?.formerManagedId;
    return formerId ? (this.drafts.get(formerId)?.source ?? null) : null;
  }

  get currentSource(): string {
    return this.source;
  }

  get currentSimplify(): boolean {
    return this.simplify;
  }

  get hasDraft(): boolean {
    const baseline = this.editingTarget ?? this.orphaned;
    return (
      baseline !== null &&
      (this.source !== baseline.source || this.simplify !== baseline.simplify)
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
    this.clearActionError();
    this.source = this.editingTarget.source;
    this.simplify = this.editingTarget.simplify;
    this.drafts.delete(this.editingTarget.id);
    this.draftBaselines.delete(this.editingTarget.id);
    this.scheduleRecovery();
    this.validateNow();
  }

  get hasAnyDraft(): boolean {
    const applied = new Map(
      this.adapter?.getManagedTexts().map((text) => [text.id, text]) ?? [],
    );
    return [...this.drafts].some(([id, draft]) => {
      const text = applied.get(id);
      return (
        !text ||
        draft.source !== text.source ||
        draft.simplify !== text.simplify
      );
    });
  }

  get dirtyConstruction(): boolean {
    if (
      this.cleanConstructionState !== null &&
      this.adapter?.getConstructionState
    ) {
      try {
        return (
          this.adapter.getConstructionState() !== this.cleanConstructionState
        );
      } catch {
        return this.constructionChanged;
      }
    }
    return this.constructionChanged;
  }

  markConstructionClean(): void {
    this.cleanConstructionState =
      this.adapter?.getConstructionState?.() ?? null;
    this.constructionChanged = false;
    this.scheduleRecovery();
    this.notify(this.compiled);
  }

  async noteDownloaded(base64: string): Promise<void> {
    this.lastSnapshot = base64;
    this.constructionFingerprint = await fingerprintConstruction(base64);
    this.presence.setFingerprint(this.constructionFingerprint);
    this.startupRecovery = false;
    this.markConstructionClean();
  }

  private assessDraft(
    id: string,
    draft: { source: string; simplify: boolean },
    text: ManagedText | undefined,
  ): {
    kind: "valid" | "invalid" | "divergent";
    reason: string;
    expression: string | null;
  } | null {
    if (
      text &&
      draft.source === text.source &&
      draft.simplify === text.simplify
    )
      return null;
    if (!text)
      return {
        kind: "invalid",
        reason: "Editing Target is unavailable.",
        expression: null,
      };
    const baseline = this.draftBaselines.get(id);
    if (
      baseline &&
      (baseline.source !== text.source ||
        baseline.simplify !== text.simplify ||
        baseline.compiledFingerprint !== text.compiledFingerprint)
    )
      return {
        kind: "divergent",
        reason: "Applied Source changed since this draft began.",
        expression: null,
      };
    const result = compileSource(draft.source, {
      simplify: draft.simplify,
      symbols: this.adapter?.getSymbols() ?? this.symbols,
    });
    const error = result.diagnostics.find(
      (diagnostic) => diagnostic.severity === "error",
    );
    return {
      kind: error ? "invalid" : "valid",
      reason: error?.message ?? "Ready to apply.",
      expression: result.expression,
    };
  }

  get draftDetails(): {
    label: string;
    kind: "valid" | "invalid" | "divergent";
    reason: string;
  }[] {
    const details: {
      label: string;
      kind: "valid" | "invalid" | "divergent";
      reason: string;
    }[] = [];
    const applied = new Map(
      this.adapter?.getManagedTexts().map((text) => [text.id, text]) ?? [],
    );
    for (const [id, draft] of this.drafts) {
      const text = applied.get(id);
      const assessment = this.assessDraft(id, draft, text);
      if (assessment)
        details.push({
          label: text?.targetLabel ?? id,
          kind: assessment.kind,
          reason: assessment.reason,
        });
    }
    return details;
  }

  async applyAllValidDrafts(): Promise<void> {
    if (!this.adapter) throw new Error("GeoGebra adapter is unavailable.");
    for (const [id, draft] of [...this.drafts]) {
      const text = this.adapter
        .getManagedTexts()
        .find((candidate) => candidate.id === id);
      const assessment = this.assessDraft(id, draft, text);
      if (!assessment) {
        this.drafts.delete(id);
        this.draftBaselines.delete(id);
        continue;
      }
      if (assessment.kind !== "valid" || !assessment.expression) continue;
      const updated = await this.adapter.applyManagedText(
        id,
        draft.source,
        draft.simplify,
        assessment.expression,
      );
      this.drafts.delete(id);
      this.draftBaselines.delete(id);
      if (this.editingTarget?.id === id) this.editingTarget = updated;
    }
    this.validateNow();
    this.scheduleRecovery();
  }

  private loadTarget(target: ManagedText | null): void {
    this.insertionGeneration++;
    this.insertionRange = null;
    if (this.editingTarget) {
      if (this.hasDraft)
        this.drafts.set(this.editingTarget.id, {
          source: this.source,
          simplify: this.simplify,
        });
      else {
        this.drafts.delete(this.editingTarget.id);
        this.draftBaselines.delete(this.editingTarget.id);
      }
    }
    if (this.orphaned && this.hasDraft)
      this.drafts.set(this.orphaned.id, {
        source: this.source,
        simplify: this.simplify,
      });
    this.editingTarget = target;
    this.orphaned = null;
    this.unmanaged = null;
    const draft = target && this.drafts.get(target.id);
    this.source = draft?.source ?? target?.source ?? "";
    this.simplify = draft?.simplify ?? target?.simplify ?? true;
    this.symbols = this.adapter?.getSymbols() ?? this.symbols;
    this.validateNow();
  }

  async create(): Promise<ManagedText> {
    if (!this.adapter) throw new Error("GeoGebra adapter is unavailable.");
    const target = await this.adapter.createManagedText();
    this.lastSnapshot = await this.adapter.exportBase64().catch(() => null);
    this.clearActionError();
    this.loadTarget(target);
    this.scheduleRecovery();
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
    this.clearActionError();
    this.editingTarget = target;
    this.drafts.delete(target.id);
    this.draftBaselines.delete(target.id);
    this.scheduleRecovery();
    return target;
  }

  async open(base64: string): Promise<ManagedText | null> {
    if (!this.adapter) throw new Error("GeoGebra adapter is unavailable.");
    const before = JSON.stringify({
      drafts: [...this.drafts],
      source: this.source,
      simplify: this.simplify,
      target: this.editingTarget?.id,
    });
    await this.adapter.importBase64(
      base64,
      () =>
        before ===
        JSON.stringify({
          drafts: [...this.drafts],
          source: this.source,
          simplify: this.simplify,
          target: this.editingTarget?.id,
        }),
    );
    this.lastSnapshot = base64;
    this.clearActionError();
    this.drafts.clear();
    this.draftBaselines.clear();
    this.undoneAdoptions.clear();
    this.retainedOrphans.clear();
    this.recoveredOrphanIds.clear();
    this.editingTarget = null;
    this.orphaned = null;
    this.selected = [];
    this.insertionRange = null;
    const target = this.adapter.getManagedTexts()[0] ?? null;
    this.loadTarget(target);
    this.constructionFingerprint = await fingerprintConstruction(base64);
    this.presence.setFingerprint(this.constructionFingerprint);
    this.startupRecovery = false;
    this.markConstructionClean();
    await this.refreshRecoveryRecords();
    return target;
  }

  async newConstruction(): Promise<void> {
    if (!this.adapter?.newConstruction)
      throw new Error("GeoGebra New is unavailable.");
    await this.adapter.newConstruction();
    this.lastSnapshot = null;
    this.clearActionError();
    this.drafts.clear();
    this.draftBaselines.clear();
    this.undoneAdoptions.clear();
    this.retainedOrphans.clear();
    this.recoveredOrphanIds.clear();
    this.editingTarget = null;
    this.orphaned = null;
    this.selected = [];
    this.loadTarget(null);
    this.constructionFingerprint = null;
    this.presence.setFingerprint(null);
    this.startupRecovery = false;
    this.markConstructionClean();
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
    if (this.unmanaged) return;
    this.manualRenameRanges = [];
    this.rememberDraftBaseline();
    this.source = source;
    if (this.editingTarget)
      this.drafts.set(this.editingTarget.id, {
        source,
        simplify: this.simplify,
      });
    if (this.orphaned)
      this.drafts.set(this.orphaned.id, { source, simplify: this.simplify });
    this.scheduleRecovery();
    this.schedule();
  }

  setSimplify(simplify: boolean): void {
    if (this.unmanaged) return;
    this.rememberDraftBaseline();
    this.simplify = simplify;
    if (this.editingTarget)
      this.drafts.set(this.editingTarget.id, { source: this.source, simplify });
    if (this.orphaned)
      this.drafts.set(this.orphaned.id, { source: this.source, simplify });
    this.scheduleRecovery();
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
    if (this.manualRenameRanges.length)
      this.compiled.diagnostics.push(
        ...this.manualRenameRanges.map((range) => ({
          ...range,
          code: "manual-rename-resolution",
          severity: "warning" as const,
          message:
            "This token may refer to a renamed object. Resolve it manually.",
        })),
      );
    this.notify(this.compiled);
    return this.compiled;
  }

  async dispose(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.presence.close();
    this.unsubscribe?.();
    await this.recoveryWrite;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.validateNow(), 300);
  }
}
