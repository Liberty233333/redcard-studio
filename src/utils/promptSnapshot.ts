import { isV21Enabled } from '../config.ts';
import { redactSecrets } from './secretRedactor.ts';

export interface PromptSnapshot {
  id: string;
  projectId: string;
  step: 'article' | 'cards' | 'cover' | 'other';
  agent: string;
  fullMessages: Array<{ role: string; content: any }>;
  systemPrompt: string;
  modelConfig: {
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  };
  response: {
    raw: any;
    extractedText?: string;
    finishReason?: string;
    tokenUsage?: { input: number; output: number };
  };
  metadata: Record<string, any>;
  durationMs: number;
  createdAt: string;
}

const DB_NAME = 'redcard-workbench';
const DB_VERSION = 3;
const STORE = 'prompt_snapshots';
const memorySnapshots = new Map<string, PromptSnapshot>();

export async function captureSnapshot(snapshot: Omit<PromptSnapshot, 'id' | 'createdAt'>): Promise<void> {
  if (!isV21Enabled()) return;
  const complete = redactSecrets({
    ...snapshot,
    id: createId(),
    createdAt: new Date().toISOString(),
  });
  const db = await openSnapshotDb();
  if (!db) {
    const saved = await writeDiskSnapshot(complete);
    if (saved) return;
    memorySnapshots.set(complete.id, complete);
    return;
  }
  await requestDone(db.transaction(STORE, 'readwrite').objectStore(STORE).put(complete));
}

export async function listSnapshots(options: {
  projectId?: string;
  step?: PromptSnapshot['step'];
  limit?: number;
  before?: string;
} = {}): Promise<PromptSnapshot[]> {
  const limit = options.limit ?? 50;
  const db = await openSnapshotDb();
  let all: PromptSnapshot[];
  if (!db) {
    all = [...(await readDiskSnapshots()), ...memorySnapshots.values()];
  } else {
    all = await requestDone<PromptSnapshot[]>(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
  }
  return all
    .filter((item) => !options.projectId || item.projectId === options.projectId)
    .filter((item) => !options.step || item.step === options.step)
    .filter((item) => !options.before || item.createdAt < options.before)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function getSnapshot(id: string): Promise<PromptSnapshot | null> {
  const db = await openSnapshotDb();
  if (!db) return (await readDiskSnapshot(id)) || memorySnapshots.get(id) || null;
  return (await requestDone<PromptSnapshot | undefined>(db.transaction(STORE, 'readonly').objectStore(STORE).get(id))) || null;
}

export async function deleteSnapshotsOlderThan(date: Date): Promise<number> {
  const cutoff = date.toISOString();
  const targets = await listSnapshots({ limit: Number.MAX_SAFE_INTEGER });
  const ids = targets.filter((item) => item.createdAt < cutoff).map((item) => item.id);
  const db = await openSnapshotDb();
  if (!db) {
    ids.forEach((id) => memorySnapshots.delete(id));
    await deleteDiskSnapshots(ids);
    return ids.length;
  }
  const transaction = db.transaction(STORE, 'readwrite');
  const store = transaction.objectStore(STORE);
  ids.forEach((id) => store.delete(id));
  await transactionDone(transaction);
  return ids.length;
}

export async function clearSnapshots(): Promise<number> {
  const items = await listSnapshots({ limit: Number.MAX_SAFE_INTEGER });
  const db = await openSnapshotDb();
  if (!db) {
    memorySnapshots.clear();
    await deleteDiskSnapshots(items.map((item) => item.id));
    return items.length;
  }
  await requestDone(db.transaction(STORE, 'readwrite').objectStore(STORE).clear());
  return items.length;
}

export function __resetPromptSnapshotMemoryForTests() {
  memorySnapshots.clear();
}

function openSnapshotDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('rules')) db.createObjectStore('rules', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('projectId', 'projectId');
        store.createIndex('step', 'step');
      }
      if (!db.objectStoreNames.contains('content_specs')) db.createObjectStore('content_specs', { keyPath: 'draftId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function writeDiskSnapshot(snapshot: PromptSnapshot): Promise<boolean> {
  if (!isNodeRuntime()) return false;
  try {
    const fs = await importNodeModule<typeof import('node:fs/promises')>('node:fs/promises');
    const path = await importNodeModule<typeof import('node:path')>('node:path');
    const dir = path.resolve(snapshotPersistDir(), snapshot.createdAt.slice(0, 10));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${snapshot.id}.json`), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function readDiskSnapshots(): Promise<PromptSnapshot[]> {
  if (!isNodeRuntime()) return [];
  try {
    const fs = await importNodeModule<typeof import('node:fs/promises')>('node:fs/promises');
    const path = await importNodeModule<typeof import('node:path')>('node:path');
    const root = path.resolve(snapshotPersistDir());
    const dayEntries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const snapshots: PromptSnapshot[] = [];
    for (const day of dayEntries) {
      if (!day.isDirectory()) continue;
      const dir = path.join(root, day.name);
      const files = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.json')) continue;
        try {
          const raw = await fs.readFile(path.join(dir, file.name), 'utf8');
          snapshots.push(JSON.parse(raw) as PromptSnapshot);
        } catch {
          // Ignore malformed one-off debug files; valid snapshots should still be readable.
        }
      }
    }
    return snapshots;
  } catch {
    return [];
  }
}

async function readDiskSnapshot(id: string): Promise<PromptSnapshot | null> {
  const snapshots = await readDiskSnapshots();
  return snapshots.find((snapshot) => snapshot.id === id) || null;
}

async function deleteDiskSnapshots(ids: string[]): Promise<void> {
  if (!ids.length || !isNodeRuntime()) return;
  try {
    const fs = await importNodeModule<typeof import('node:fs/promises')>('node:fs/promises');
    const path = await importNodeModule<typeof import('node:path')>('node:path');
    const idSet = new Set(ids);
    const root = path.resolve(snapshotPersistDir());
    const dayEntries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const day of dayEntries) {
      if (!day.isDirectory()) continue;
      const dir = path.join(root, day.name);
      const files = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      await Promise.all(files
        .filter((file) => file.isFile() && file.name.endsWith('.json') && idSet.has(file.name.slice(0, -5)))
        .map((file) => fs.unlink(path.join(dir, file.name)).catch(() => undefined)));
    }
  } catch {
    // Best-effort cleanup only.
  }
}

function snapshotPersistDir(): string {
  const proc = (globalThis as any).process;
  return proc?.env?.SNAPSHOT_PERSIST_DIR || 'docs/exec-plans/active/snapshots';
}

function isNodeRuntime(): boolean {
  const proc = (globalThis as any).process;
  return Boolean(proc?.versions?.node);
}

function importNodeModule<T>(specifier: string): Promise<T> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (value: string) => Promise<T>;
  return dynamicImport(specifier);
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
