import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { AuthoringWorkspace, type WorkspaceAdapter } from "../../src/workspace";
import {
  clearLocalRecoveryData,
  constructionFingerprint,
  saveRecoveryRecord,
} from "../../src/recovery";
import type { ManagedText } from "../../src/geogebra";

const original: ManagedText = {
  id: "original-id",
  targetLabel: "text1",
  source: "Applied",
  simplify: true,
  compiledFingerprint: "command-fingerprint",
};

function adapter(texts: ManagedText[] = [original]): WorkspaceAdapter {
  let construction = "initial";
  return {
    getSymbols: () => [],
    getUnmanagedTextSnapshot: () => "",
    adoptUnmanagedText: async () => texts[0]!,
    createManagedText: async () => texts[0]!,
    applyManagedText: async () => texts[0]!,
    importBase64: async () => {
      construction = "opened";
    },
    newConstruction: async () => {
      construction = "initial";
    },
    getManagedTexts: () => texts,
    getConstructionState: () => construction,
    exportBase64: async () => "local-construction-snapshot",
  };
}

afterEach(async () => {
  await clearLocalRecoveryData();
  vi.useRealTimers();
});

it("offers an interrupted Draft Source and restores it only after an explicit choice", async () => {
  const interrupted = new AuthoringWorkspace(() => {}, adapter());
  interrupted.markConstructionClean();
  await interrupted.create();
  interrupted.setSource("Unapplied after crash");
  await vi.waitFor(
    async () => {
      const probe = new AuthoringWorkspace(() => {}, adapter());
      await probe.refreshRecoveryRecords();
      expect(probe.recoveryCandidates).toHaveLength(1);
      await probe.dispose();
    },
    { timeout: 3_000 },
  );
  await interrupted.dispose();
  const reopened = new AuthoringWorkspace(() => {}, adapter());
  await reopened.refreshRecoveryRecords();
  expect(reopened.currentSource).toBe("");
  const candidate = reopened.recoveryCandidates[0]!;
  await reopened.restoreRecovery(candidate.key, true);
  expect(reopened.currentSource).toBe("Unapplied after crash");
  expect(reopened.hasAnyDraft).toBe(true);
  expect(reopened.recoveryCandidates).toHaveLength(0);
  await reopened.dispose();
});

it("leaves a Recovery Draft orphaned when a fingerprint matches multiple targets", async () => {
  const interrupted = new AuthoringWorkspace(() => {}, adapter());
  interrupted.markConstructionClean();
  await interrupted.create();
  interrupted.setSource("Ambiguous draft");
  await vi.waitFor(
    async () => {
      const probe = new AuthoringWorkspace(() => {}, adapter());
      await probe.refreshRecoveryRecords();
      expect(probe.recoveryCandidates).toHaveLength(1);
      await probe.dispose();
    },
    { timeout: 3_000 },
  );
  await interrupted.dispose();
  const duplicate = (id: string): ManagedText => ({ ...original, id });
  const reopened = new AuthoringWorkspace(
    () => {},
    adapter([duplicate("a"), duplicate("b")]),
  );
  await reopened.refreshRecoveryRecords();
  await reopened.restoreRecovery(reopened.recoveryCandidates[0]!.key, true);
  expect(reopened.target).toBeNull();
  expect(reopened.orphanedTarget?.candidates).toEqual(["text1", "text1"]);
  expect(reopened.currentSource).toBe("Ambiguous draft");
  await reopened.dispose();
});

it("prunes expired data and reports explicit clearing", async () => {
  const oldFingerprint = await constructionFingerprint("old-file");
  await saveRecoveryRecord({
    key: `${oldFingerprint}:expired-workspace`,
    workspaceId: "expired-workspace",
    constructionFingerprint: oldFingerprint,
    snapshot: "old-file",
    drafts: [],
    dirtyConstruction: true,
    savedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
  });
  const current = new AuthoringWorkspace(() => {}, adapter());
  await current.open("current-file");
  await current.create();
  current.setSource("Local draft");
  await vi.waitFor(
    async () => {
      const probe = new AuthoringWorkspace(() => {}, adapter());
      await probe.open("current-file");
      expect(probe.recoveryCandidates).toHaveLength(1);
      await probe.dispose();
    },
    { timeout: 3_000 },
  );
  const removed = await current.clearLocalRecovery();
  expect(removed.records).toBe(1);
  expect(removed.bytes).toBeGreaterThan(0);
  const reopened = new AuthoringWorkspace(() => {}, adapter());
  await reopened.open("current-file");
  expect(reopened.recoveryCandidates).toHaveLength(0);
  await current.dispose();
  await reopened.dispose();
});

it("keeps unrelated files separate and warns two live tabs about the same file without syncing drafts", async () => {
  const first = new AuthoringWorkspace(() => {}, adapter());
  await first.open("shared-file");
  await first.create();
  first.setSource("Only in first tab");
  const unrelated = new AuthoringWorkspace(() => {}, adapter());
  await unrelated.open("other-file");
  expect(unrelated.recoveryCandidates).toHaveLength(0);
  expect(unrelated.concurrentTabWarning).toBe(false);
  const second = new AuthoringWorkspace(() => {}, adapter());
  await second.open("shared-file");
  await vi.waitFor(() => {
    expect(first.concurrentTabWarning).toBe(true);
    expect(second.concurrentTabWarning).toBe(true);
  });
  expect(second.currentSource).toBe("Applied");
  expect(second.hasAnyDraft).toBe(false);
  await first.dispose();
  await second.dispose();
  await unrelated.dispose();
});

it("restores a recovered Orphaned Source as a new Managed Text Object only on request", async () => {
  const duplicate = (id: string): ManagedText => ({ ...original, id });
  const texts = [duplicate("a"), duplicate("b")];
  const fake = adapter(texts);
  fake.createManagedText = async () => {
    const created = {
      ...original,
      id: "new-id",
      targetLabel: "text3",
      source: "",
    };
    texts.push(created);
    return created;
  };
  fake.applyManagedText = async (id, source, simplify) => {
    const index = texts.findIndex((text) => text.id === id);
    texts[index] = { ...texts[index]!, source, simplify };
    return texts[index]!;
  };
  await saveRecoveryRecord({
    key: "unsaved:old-tab",
    workspaceId: "old-tab",
    constructionFingerprint: null,
    snapshot: "local-construction-snapshot",
    drafts: [
      {
        id: original.id,
        targetLabel: original.targetLabel,
        source: "Recovered orphan",
        simplify: true,
        baseline: {
          source: original.source,
          simplify: original.simplify,
          compiledFingerprint: original.compiledFingerprint,
        },
      },
    ],
    dirtyConstruction: true,
    savedAt: Date.now(),
  });
  const reopened = new AuthoringWorkspace(() => {}, fake);
  await reopened.refreshRecoveryRecords();
  await reopened.restoreRecovery("unsaved:old-tab", true);
  expect(reopened.target).toBeNull();
  expect(texts).toHaveLength(2);
  expect(reopened.canRestoreOrphaned).toBe(true);
  await reopened.restoreOrphaned();
  expect(reopened.target?.id).toBe("new-id");
  expect(reopened.target?.source).toBe("Recovered orphan");
  expect(texts).toHaveLength(3);
  await reopened.dispose();
});

it("retains an unassigned recovered Orphaned Source through another interruption", async () => {
  const orphaned = new AuthoringWorkspace(() => {}, adapter([]));
  await saveRecoveryRecord({
    key: "unsaved:old-tab",
    workspaceId: "old-tab",
    constructionFingerprint: null,
    snapshot: "local-construction-snapshot",
    drafts: [
      {
        id: original.id,
        targetLabel: original.targetLabel,
        source: "Still recoverable",
        simplify: true,
        baseline: {
          source: original.source,
          simplify: original.simplify,
          compiledFingerprint: original.compiledFingerprint,
        },
      },
    ],
    dirtyConstruction: true,
    savedAt: Date.now(),
  });
  await orphaned.refreshRecoveryRecords();
  await orphaned.restoreRecovery("unsaved:old-tab", true);
  expect(orphaned.currentSource).toBe("Still recoverable");
  await vi.waitFor(
    async () => {
      const next = new AuthoringWorkspace(() => {}, adapter([]));
      await next.refreshRecoveryRecords();
      expect(next.recoveryCandidates).toHaveLength(1);
      expect(next.recoveryCandidates[0]?.drafts[0]?.source).toBe(
        "Still recoverable",
      );
      await next.dispose();
    },
    { timeout: 3_000 },
  );
  await orphaned.dispose();
});

it("reports both orphaned identity and divergence in a mixed recovery", async () => {
  const changed = { ...original, source: "Changed applied source" };
  await saveRecoveryRecord({
    key: "unsaved:old-tab",
    workspaceId: "old-tab",
    constructionFingerprint: null,
    snapshot: "local-construction-snapshot",
    drafts: [
      {
        id: original.id,
        targetLabel: original.targetLabel,
        source: "Diverged draft",
        simplify: true,
        baseline: {
          source: original.source,
          simplify: true,
          compiledFingerprint: original.compiledFingerprint,
        },
      },
      {
        id: "missing-id",
        targetLabel: "text2",
        source: "Orphaned draft",
        simplify: true,
        baseline: {
          source: "Missing baseline",
          simplify: true,
          compiledFingerprint: "missing-fingerprint",
        },
      },
    ],
    dirtyConstruction: true,
    savedAt: Date.now(),
  });
  const workspace = new AuthoringWorkspace(() => {}, adapter([changed]));
  await workspace.refreshRecoveryRecords();
  await workspace.restoreRecovery("unsaved:old-tab", true);
  expect(workspace.interactionMessage).toContain("diverges");
  expect(workspace.interactionMessage).toContain("Orphaned Source");
  await workspace.dispose();
});

it("ignores a malformed local record without hiding valid recovery", async () => {
  await saveRecoveryRecord({
    key: "unsaved:valid-tab",
    workspaceId: "valid-tab",
    constructionFingerprint: null,
    snapshot: "valid-snapshot",
    drafts: [],
    dirtyConstruction: true,
    savedAt: Date.now(),
  });
  await new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open("gglatex-editor-recovery", 2);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction("drafts", "readwrite");
      transaction.objectStore("drafts").put(
        {
          key: "unsaved:broken-tab",
          workspaceId: "broken-tab",
          constructionFingerprint: null,
          snapshot: "bad-snapshot",
          drafts: [null],
          dirtyConstruction: true,
          savedAt: Date.now(),
        },
        "unsaved:broken-tab",
      );
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
  const workspace = new AuthoringWorkspace(() => {}, adapter());
  await workspace.refreshRecoveryRecords();
  expect(
    workspace.recoveryCandidates.map((record) => record.workspaceId),
  ).toEqual(["valid-tab"]);
  await workspace.dispose();
});
