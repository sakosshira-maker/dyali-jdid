// Browser storage engine: IndexedDB first (large, durable), localStorage as a
// fallback, and memory as a last resort. Nothing here talks to a server.
export type Row = Record<string, any> & { id: number };
export type WriteOps = { put?: Array<{ t: string; row: Row }>; del?: Array<{ t: string; id: number }> };

export interface Backend {
  kind: "indexeddb" | "localstorage" | "memory";
  all(t: string): Promise<Row[]>;
  get(t: string, id: number): Promise<Row | undefined>;
  write(ops: WriteOps): Promise<void>;
  nextId(t: string): Promise<number>;
  metaGet<T = unknown>(key: string): Promise<T | undefined>;
  metaSet(key: string, value: unknown): Promise<void>;
  replaceAll(tables: Record<string, Row[]>, meta: Record<string, unknown>): Promise<void>;
  dump(tables: string[]): Promise<Record<string, Row[]>>;
}

const DB_NAME = "petit-cahier";
const ROWS = "rows";
const META = "meta";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB"));
  });
}
const strip = (record: Record<string, unknown>): Row => {
  const { t: _table, ...row } = record;
  void _table;
  return row as Row;
};

function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ROWS)) db.createObjectStore(ROWS, { keyPath: ["t", "id"] }).createIndex("t", "t");
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

function indexedDbBackend(db: IDBDatabase): Backend {
  const writer = (stores: string[]) => db.transaction(stores, "readwrite", { durability: "strict" });
  return {
    kind: "indexeddb",
    async all(t) {
      const rows = await request(db.transaction(ROWS, "readonly").objectStore(ROWS).index("t").getAll(IDBKeyRange.only(t)));
      return rows.map(strip);
    },
    async get(t, id) {
      const row = await request(db.transaction(ROWS, "readonly").objectStore(ROWS).get([t, id]));
      return row ? strip(row) : undefined;
    },
    async write(ops) {
      if (!ops.put?.length && !ops.del?.length) return;
      const tx = writer([ROWS]);
      const store = tx.objectStore(ROWS);
      for (const { t, id } of ops.del || []) store.delete([t, id]);
      for (const { t, row } of ops.put || []) store.put({ ...row, t });
      await completed(tx);
    },
    nextId(t) {
      // Atomic across tabs: the highest stored id and the counter are read and
      // bumped inside a single transaction.
      return new Promise((resolve, reject) => {
        const tx = writer([ROWS, META]);
        let next = 0;
        const cursor = tx.objectStore(ROWS).index("t").openKeyCursor(IDBKeyRange.only(t), "prev");
        cursor.onsuccess = () => {
          const maxId = cursor.result ? Number((cursor.result.primaryKey as [string, number])[1]) : 0;
          const meta = tx.objectStore(META);
          const seq = meta.get(`seq:${t}`);
          seq.onsuccess = () => {
            next = Math.max(Number(seq.result) || 0, maxId) + 1;
            meta.put(next, `seq:${t}`);
          };
        };
        tx.oncomplete = () => resolve(next);
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB"));
      });
    },
    async metaGet(key) {
      return (await request(db.transaction(META, "readonly").objectStore(META).get(key))) ?? undefined;
    },
    async metaSet(key, value) {
      const tx = writer([META]);
      tx.objectStore(META).put(value, key);
      await completed(tx);
    },
    async replaceAll(tables, meta) {
      const tx = writer([ROWS, META]);
      const rows = tx.objectStore(ROWS);
      const metaStore = tx.objectStore(META);
      rows.clear();
      metaStore.clear();
      for (const [t, list] of Object.entries(tables)) for (const row of list) rows.put({ ...row, t });
      for (const [key, value] of Object.entries(meta)) metaStore.put(value, key);
      await completed(tx);
    },
    async dump(tables) {
      const all = await request(db.transaction(ROWS, "readonly").objectStore(ROWS).getAll());
      const out: Record<string, Row[]> = Object.fromEntries(tables.map((t) => [t, [] as Row[]]));
      for (const record of all) {
        const t = String(record.t);
        (out[t] ||= []).push(strip(record));
      }
      return out;
    },
  };
}

/** Same API on top of localStorage (smaller quota, used if IndexedDB is blocked). */
function keyValueBackend(kind: "localstorage" | "memory"): Backend {
  const memory = new Map<string, string>();
  const prefix = "petit-cahier:db:";
  const getItem = (k: string) => (kind === "memory" ? memory.get(k) ?? null : window.localStorage.getItem(prefix + k));
  const setItem = (k: string, v: string) => { if (kind === "memory") memory.set(k, v); else window.localStorage.setItem(prefix + k, v); };
  const removeItem = (k: string) => { if (kind === "memory") memory.delete(k); else window.localStorage.removeItem(prefix + k); };
  const load = (t: string): Row[] => { try { return JSON.parse(getItem(`t:${t}`) || "[]"); } catch { return []; } };
  const save = (t: string, rows: Row[]) => setItem(`t:${t}`, JSON.stringify(rows.sort((a, b) => a.id - b.id)));
  const knownTables = (): string[] => { try { return JSON.parse(getItem("tables") || "[]"); } catch { return []; } };
  const remember = (t: string) => { const list = knownTables(); if (!list.includes(t)) setItem("tables", JSON.stringify([...list, t])); };
  return {
    kind,
    async all(t) { return load(t); },
    async get(t, id) { return load(t).find((r) => r.id === id); },
    async write(ops) {
      const touched = new Map<string, Row[]>();
      const table = (t: string) => { if (!touched.has(t)) touched.set(t, load(t)); return touched.get(t)!; };
      for (const { t, id } of ops.del || []) touched.set(t, table(t).filter((r) => r.id !== id));
      for (const { t, row } of ops.put || []) { const rows = table(t).filter((r) => r.id !== row.id); rows.push(JSON.parse(JSON.stringify(row))); touched.set(t, rows); }
      for (const [t, rows] of touched) { save(t, rows); remember(t); }
    },
    async nextId(t) {
      const maxId = load(t).reduce((m, r) => Math.max(m, r.id), 0);
      const next = Math.max(Number(getItem(`seq:${t}`)) || 0, maxId) + 1;
      setItem(`seq:${t}`, String(next));
      return next;
    },
    async metaGet(key) { const raw = getItem(`meta:${key}`); return raw === null ? undefined : JSON.parse(raw); },
    async metaSet(key, value) { setItem(`meta:${key}`, JSON.stringify(value)); },
    async replaceAll(tables, meta) {
      for (const t of knownTables()) { removeItem(`t:${t}`); removeItem(`seq:${t}`); }
      for (const [t, rows] of Object.entries(tables)) { save(t, [...rows]); remember(t); }
      for (const [key, value] of Object.entries(meta)) setItem(`meta:${key}`, JSON.stringify(value));
    },
    async dump(tables) { return Object.fromEntries([...new Set([...tables, ...knownTables()])].map((t) => [t, load(t)])); },
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

export async function openBackend(): Promise<Backend> {
  if (typeof indexedDB !== "undefined") {
    try { return indexedDbBackend(await withTimeout(openIndexedDb(), 6000)); } catch { /* try the next engine */ }
  }
  try {
    window.localStorage.setItem("petit-cahier:db:probe", "1");
    window.localStorage.removeItem("petit-cahier:db:probe");
    return keyValueBackend("localstorage");
  } catch {
    return keyValueBackend("memory");
  }
}
