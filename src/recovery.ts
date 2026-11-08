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
  savedAt: number;
}

const DATABASE = "gglatex-editor-recovery";
const STORE = "drafts";
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
    (record.constructionFingerprint === null ||
      typeof record.constructionFingerprint === "string") &&
    typeof record.snapshot === "string" &&
    typeof record.savedAt === "number" &&
    Array.isArray(record.drafts) &&
    record.drafts.every((draft) =>
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
      transaction.oncomplete = () =>
        resolve(records.sort((left, right) => right.savedAt - left.savedAt));
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function saveRecoveryRecord(record: RecoveryRecord): Promise<void> {
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
}

export async function clearLocalRecoveryData(): Promise<{
  records: number;
  bytes: number;
}> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      let records = 0;
      let bytes = 0;
      const transaction = database.transaction(
        [STORE, "failed-apply"],
        "readwrite",
      );
      for (const name of [STORE, "failed-apply"]) {
        const request = transaction.objectStore(name).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          records++;
          bytes += new TextEncoder().encode(JSON.stringify(cursor.value)).length;
          cursor.delete();
          cursor.continue();
        };
      }
      transaction.oncomplete = () => resolve({ records, bytes });
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
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
  private peers = new Set<string>();
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
          this.peers.add(message.tabId);
          if (message.kind === "hello") this.send("present");
        }
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
      this.heartbeat ??= setInterval(() => this.send("hello"), 5_000);
    } else if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private send(kind: PresenceMessage["kind"]): void {
    if (this.channel && this.fingerprint)
      this.channel.postMessage({ kind, tabId: this.tabId, fingerprint: this.fingerprint });
  }

  close(): void {
    this.send("leaving");
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.channel?.close();
  }
}
