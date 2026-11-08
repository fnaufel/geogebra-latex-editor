import type { ManagedText } from "./geogebra";

export interface RecoveryDraft {
  id: string;
  targetLabel: string;
  source: string;
  simplify: boolean;
  baseline: Pick<ManagedText, "source" | "simplify" | "compiledFingerprint">;
}

export interface RecoveryRecord {
  key: string;
  workspaceId: string;
  constructionFingerprint: string | null;
  snapshot: string;
  drafts: RecoveryDraft[];
  dirtyConstruction: boolean;
  savedAt: number;
}

const DATABASE = "gglatex-editor-recovery";
const STORE = "drafts";
const STAGED = "gglatex-editor-recovery-stage";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export async function constructionFingerprint(base64: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(base64),
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("failed-apply"))
        request.result.createObjectStore("failed-apply");
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function validRecord(value: unknown): value is RecoveryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<RecoveryRecord>;
  return (
    typeof record.key === "string" &&
    typeof record.workspaceId === "string" &&
    record.workspaceId.length > 0 &&
    (record.constructionFingerprint === null ||
      typeof record.constructionFingerprint === "string") &&
    typeof record.snapshot === "string" &&
    record.snapshot.length > 0 &&
    typeof record.dirtyConstruction === "boolean" &&
    typeof record.savedAt === "number" &&
    Number.isFinite(record.savedAt) &&
    record.key ===
      `${record.constructionFingerprint ?? "unsaved"}:${record.workspaceId}` &&
    Array.isArray(record.drafts) &&
    record.drafts.every(
      (draft) =>
        draft !== null &&
        typeof draft === "object" &&
        typeof draft.id === "string" &&
        typeof draft.targetLabel === "string" &&
        typeof draft.source === "string" &&
        typeof draft.simplify === "boolean" &&
        typeof draft.baseline?.source === "string" &&
        typeof draft.baseline?.simplify === "boolean" &&
        typeof draft.baseline?.compiledFingerprint === "string",
    )
  );
}

function stagedRecord(): RecoveryRecord | null {
  try {
    const stored = sessionStorage.getItem(STAGED);
    if (!stored) return null;
    const record: unknown = JSON.parse(stored);
    if (validRecord(record) && record.savedAt >= Date.now() - MAX_AGE_MS)
      return record;
    sessionStorage.removeItem(STAGED);
  } catch {
    // Session storage is only a best-effort synchronous journal.
  }
  return null;
}

export function stageRecoveryRecord(record: RecoveryRecord): void {
  try {
    sessionStorage.setItem(STAGED, JSON.stringify(record));
  } catch {
    // IndexedDB still retains the durable record when session storage is unavailable.
  }
}

export function unstageRecoveryRecord(key: string): void {
  try {
    if (stagedRecord()?.key === key) sessionStorage.removeItem(STAGED);
  } catch {
    // Session storage can be disabled independently.
  }
}

export async function listRecoveryRecords(): Promise<RecoveryRecord[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const records: RecoveryRecord[] = [];
      const transaction = database.transaction(STORE, "readwrite");
      const request = transaction.objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (
          !validRecord(cursor.value) ||
          cursor.value.savedAt < Date.now() - MAX_AGE_MS
        )
          cursor.delete();
        else records.push(cursor.value);
        cursor.continue();
      };
      transaction.oncomplete = () => {
        const staged = stagedRecord();
        if (staged) {
          const index = records.findIndex(
            (record) => record.key === staged.key,
          );
          if (index >= 0) records[index] = staged;
          else records.push(staged);
        }
        resolve(records.sort((left, right) => right.savedAt - left.savedAt));
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function saveRecoveryRecord(
  record: RecoveryRecord,
): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(record, record.key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function removeRecoveryRecord(key: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
  unstageRecoveryRecord(key);
}

async function scanLocalRecoveryData(clear: boolean): Promise<{
  records: number;
  bytes: number;
}> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      let records = 0;
      let bytes = 0;
      const keys = new Set<string>();
      const transaction = database.transaction(
        [STORE, "failed-apply"],
        clear ? "readwrite" : "readonly",
      );
      for (const name of [STORE, "failed-apply"]) {
        const request = transaction.objectStore(name).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          records++;
          keys.add(String(cursor.key));
          bytes += new TextEncoder().encode(
            JSON.stringify(cursor.value),
          ).length;
          if (clear) cursor.delete();
          cursor.continue();
        };
      }
      transaction.oncomplete = () => {
        const stage = stagedRecord();
        if (stage) {
          if (!keys.has(stage.key)) records++;
          bytes += new TextEncoder().encode(
            sessionStorage.getItem(STAGED) ?? "",
          ).length;
        }
        resolve({ records, bytes });
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
    if (clear)
      try {
        sessionStorage.removeItem(STAGED);
      } catch {
        // Session storage can be disabled independently.
      }
  }
}

export function measureLocalRecoveryData(): Promise<{
  records: number;
  bytes: number;
}> {
  return scanLocalRecoveryData(false);
}

export function clearLocalRecoveryData(): Promise<{
  records: number;
  bytes: number;
}> {
  return scanLocalRecoveryData(true);
}

type PresenceMessage = {
  kind: "hello" | "present" | "leaving";
  tabId: string;
  fingerprint: string;
};

export class TabPresence {
  private readonly tabId = crypto.randomUUID();
  private readonly channel =
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel("gglatex-editor-presence");
  private fingerprint: string | null = null;
  private peers = new Map<string, number>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly onChange: (concurrent: boolean) => void) {
    if (this.channel)
      this.channel.onmessage = (event: MessageEvent<PresenceMessage>) => {
        const message = event.data;
        if (
          !message ||
          message.tabId === this.tabId ||
          message.fingerprint !== this.fingerprint
        )
          return;
        if (message.kind === "leaving") this.peers.delete(message.tabId);
        else {
          this.peers.set(message.tabId, Date.now());
          if (message.kind === "hello") this.send("present");
        }
        this.prunePeers();
        this.onChange(this.peers.size > 0);
      };
  }

  setFingerprint(fingerprint: string | null): void {
    if (this.fingerprint === fingerprint) return;
    this.send("leaving");
    this.fingerprint = fingerprint;
    this.peers.clear();
    this.onChange(false);
    if (fingerprint) {
      this.send("hello");
      this.heartbeat ??= setInterval(() => {
        this.prunePeers();
        this.onChange(this.peers.size > 0);
        this.send("hello");
      }, 5_000);
    } else if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private send(kind: PresenceMessage["kind"]): void {
    if (this.channel && this.fingerprint)
      this.channel.postMessage({
        kind,
        tabId: this.tabId,
        fingerprint: this.fingerprint,
      });
  }

  private prunePeers(): void {
    for (const [id, lastSeen] of this.peers)
      if (Date.now() - lastSeen > 15_000) this.peers.delete(id);
  }

  close(): void {
    this.send("leaving");
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.channel?.close();
  }
}
