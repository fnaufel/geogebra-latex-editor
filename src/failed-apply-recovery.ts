export interface FailedApplyRecovery {
  snapshot: string;
  id: string;
  source: string;
  simplify: boolean;
  workspaceId: string;
  constructionFingerprint: string;
  recordId: string;
  savedAt: number;
}

const DATABASE = "gglatex-editor-recovery";
const STORE = "failed-apply";
const WORKSPACE_NAME_PREFIX = "gglatex-editor-workspace:";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function workspaceId(): string {
  if (window.name.startsWith(WORKSPACE_NAME_PREFIX))
    return window.name.slice(WORKSPACE_NAME_PREFIX.length);
  const id = crypto.randomUUID();
  window.name = `${WORKSPACE_NAME_PREFIX}${id}`;
  return id;
}

function recordKey(recovery: FailedApplyRecovery): string {
  return `${recovery.constructionFingerprint}:${recovery.workspaceId}:${recovery.recordId}`;
}

async function fingerprint(snapshot: string): Promise<string> {
  const bytes = new TextEncoder().encode(snapshot);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
      if (!request.result.objectStoreNames.contains("drafts"))
        request.result.createObjectStore("drafts");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function validRecovery(value: unknown): FailedApplyRecovery | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.snapshot === "string" &&
    typeof candidate.id === "string" &&
    typeof candidate.source === "string" &&
    typeof candidate.simplify === "boolean" &&
    typeof candidate.workspaceId === "string" &&
    typeof candidate.constructionFingerprint === "string" &&
    typeof candidate.recordId === "string" &&
    typeof candidate.savedAt === "number"
    ? (candidate as unknown as FailedApplyRecovery)
    : null;
}

export async function readFailedApplyRecovery(): Promise<FailedApplyRecovery | null> {
  const currentWorkspace = workspaceId();
  const cutoff = Date.now() - MAX_AGE_MS;
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const records: FailedApplyRecovery[] = [];
      const request = transaction.objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const recovery = validRecovery(cursor.value);
        if (!recovery || recovery.savedAt < cutoff) cursor.delete();
        else if (recovery.workspaceId === currentWorkspace)
          records.push(recovery);
        cursor.continue();
      };
      transaction.oncomplete = () =>
        resolve(
          records.sort((left, right) => right.savedAt - left.savedAt)[0] ??
            null,
        );
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function saveFailedApplyRecovery(
  recovery: Pick<
    FailedApplyRecovery,
    "snapshot" | "id" | "source" | "simplify"
  >,
): Promise<FailedApplyRecovery> {
  const saved: FailedApplyRecovery = {
    ...recovery,
    workspaceId: workspaceId(),
    constructionFingerprint: await fingerprint(recovery.snapshot),
    recordId: crypto.randomUUID(),
    savedAt: Date.now(),
  };
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(saved, recordKey(saved));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return saved;
  } finally {
    database.close();
  }
}

export async function clearFailedApplyRecovery(
  recovery: FailedApplyRecovery,
): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(recordKey(recovery));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
