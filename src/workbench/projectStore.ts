import type { ProviderConfig, RedCardProject, ReviewRule } from '../types';

const DB_NAME = 'redcard-workbench';
const DB_VERSION = 3;
const PROJECT_STORE = 'projects';
const RULE_STORE = 'rules';
const META_STORE = 'meta';
const PROMPT_SNAPSHOT_STORE = 'prompt_snapshots';
const CONTENT_SPEC_STORE = 'content_specs';

export const ACTIVE_PROJECT_KEY = 'activeProjectId';
export const PROVIDER_KEY = 'providers';

export const defaultProviders: ProviderConfig = {
  text: {
    provider: 'claude_relay',
    apiKey: '',
    relayUrl: '',
    model: 'claude-sonnet-4-6',
  },
  image: {
    provider: 'custom_relay',
    apiKey: '',
    relayUrl: '',
    model: 'gpt-image-2',
    size: '1056x1408',
    quality: 'high',
  },
};

export function createProject(name = '未命名图文'): RedCardProject {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    rawInput: '',
    articleDraft: '',
    dbCheckReport: '',
    cardText: '',
    publishCaption: '',
    articleInstruction: '',
    coverInstruction: '',
    coverVisualInstruction: '',
    cardInstruction: '',
    coverTitle: '',
    coverSubtitle: '',
    coverSeries: '',
    coverRedAccent: '',
    coverPaletteFamily: 'auto',
    coverMode: 'auto',
    accountName: '',
    coverPrompt: '',
    coverImage: null,
    avatarImage: '',
    coverHistory: [],
    referenceImages: [],
    theme: 'editorial_narrative',
    fontSize: 19,
    revisionLog: [],
    createdAt: now,
    updatedAt: now,
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(RULE_STORE)) {
        db.createObjectStore(RULE_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
      if (!db.objectStoreNames.contains(PROMPT_SNAPSHOT_STORE)) {
        const store = db.createObjectStore(PROMPT_SNAPSHOT_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('projectId', 'projectId');
        store.createIndex('step', 'step');
      }
      if (!db.objectStoreNames.contains(CONTENT_SPEC_STORE)) {
        db.createObjectStore(CONTENT_SPEC_STORE, { keyPath: 'draftId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | void> {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const req = run(store);
    if (req) {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } else {
      transaction.oncomplete = () => resolve();
    }
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

export async function loadProjects(): Promise<RedCardProject[]> {
  const result = await tx<RedCardProject[]>(PROJECT_STORE, 'readonly', (store) => store.getAll());
  return (result || []).map(normalizeProject).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveProject(project: RedCardProject): Promise<void> {
  const next = { ...project, updatedAt: new Date().toISOString() };
  await tx(PROJECT_STORE, 'readwrite', (store) => store.put(next));
}

export async function deleteProject(id: string): Promise<void> {
  await tx(PROJECT_STORE, 'readwrite', (store) => store.delete(id));
}

export async function loadRules(): Promise<ReviewRule[]> {
  const result = await tx<ReviewRule[]>(RULE_STORE, 'readonly', (store) => store.getAll());
  return (result || []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveRule(rule: ReviewRule): Promise<void> {
  await tx(RULE_STORE, 'readwrite', (store) => store.put(rule));
}

export async function loadMeta<T>(key: string, fallback: T): Promise<T> {
  const result = await tx<T>(META_STORE, 'readonly', (store) => store.get(key));
  return (result ?? fallback) as T;
}

export async function saveMeta<T>(key: string, value: T): Promise<void> {
  await tx(META_STORE, 'readwrite', (store) => store.put(value, key));
}

export function activeRuleText(rules: ReviewRule[], scope: ReviewRule['scope']): string {
  const relevant = rules.filter((r) => r.status === 'active' && (r.scope === 'global' || r.scope === scope));
  if (!relevant.length) return '暂无已确认长期规则。';
  return relevant.map((r, i) => `${i + 1}. ${r.title}：${r.body}`).join('\n');
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function normalizeProject(project: RedCardProject): RedCardProject {
  return {
    ...project,
    dbCheckReport: project.dbCheckReport || '',
    publishCaption: project.publishCaption || '',
    coverVisualInstruction: project.coverVisualInstruction || '',
    coverRedAccent: project.coverRedAccent || '',
    coverPaletteFamily: project.coverPaletteFamily || 'auto',
    coverSeries: project.coverSeries || '',
    accountName: project.accountName || '',
    avatarImage: project.avatarImage || '',
  };
}
