import { normalizeContentSpec, type ContentSpec } from '../spec/contentSpec.ts';

const DB_NAME = 'redcard-workbench';
const DB_VERSION = 3;
const STORE = 'content_specs';

interface StoredContentSpec {
  draftId: string;
  spec: ContentSpec;
  updatedAt: string;
}

const memorySpecs = new Map<string, StoredContentSpec>();

export async function saveSpec(draftId: string, spec: ContentSpec): Promise<void> {
  const record: StoredContentSpec = {
    draftId,
    spec: normalizeContentSpec(spec),
    updatedAt: new Date().toISOString(),
  };
  const db = await openSpecDb();
  if (!db) {
    memorySpecs.set(draftId, record);
    return;
  }
  await requestDone(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record));
}

export async function getSpec(draftId: string): Promise<ContentSpec | null> {
  const db = await openSpecDb();
  if (!db) return memorySpecs.get(draftId)?.spec || null;
  const record = await requestDone<StoredContentSpec | undefined>(
    db.transaction(STORE, 'readonly').objectStore(STORE).get(draftId)
  );
  return record?.spec ? normalizeContentSpec(record.spec) : null;
}

export function __resetSpecStoreForTests(): void {
  memorySpecs.clear();
}

function openSpecDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      ensureWorkbenchStores(req.result);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function ensureWorkbenchStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('rules')) db.createObjectStore('rules', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
  if (!db.objectStoreNames.contains('prompt_snapshots')) {
    const store = db.createObjectStore('prompt_snapshots', { keyPath: 'id' });
    store.createIndex('createdAt', 'createdAt');
    store.createIndex('projectId', 'projectId');
    store.createIndex('step', 'step');
  }
  if (!db.objectStoreNames.contains(STORE)) {
    db.createObjectStore(STORE, { keyPath: 'draftId' });
  }
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
