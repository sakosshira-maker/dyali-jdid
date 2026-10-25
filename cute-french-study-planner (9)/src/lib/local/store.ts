// The app's database now lives inside the browser. This module owns startup,
// the one-time import of older server data, cross-tab safety and backups.
import { openBackend, type Backend, type Row } from "./backend";
import { ALL_TABLES, CASCADES, GENERIC_TABLES } from "./tables";
import { buildSeed } from "./seed";

export type { Backend, Row } from "./backend";

let backendPromise: Promise<Backend> | null = null;

export function iso() {
  return new Date().toISOString();
}

/** Turns browser storage failures into a clear French message. */
export function friendlyError(error: unknown): Error {
  if (error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")) {
    return new Error("L'espace de stockage de ton navigateur est plein. Télécharge une sauvegarde, puis supprime d'anciens enregistrements audio ou fichiers.");
  }
  return error instanceof Error ? error : new Error("Enregistrement impossible dans ce navigateur.");
}

async function importLegacyServerData(b: Backend): Promise<boolean> {
  // Notes written before the switch to browser storage are copied once, if the
  // old database is reachable. Without it (e.g. on Netlify), we simply seed.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch("/api/export", { cache: "no-store", signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const json = await res.json();
    const tables = json?.available ? (json.tables as Record<string, Row[]> | undefined) : undefined;
    if (!tables || ((tables.modules?.length || 0) + (tables.pages?.length || 0)) === 0) return false;
    const put: Array<{ t: string; row: Row }> = [];
    for (const t of ALL_TABLES) {
      for (const row of Array.isArray(tables[t]) ? tables[t] : []) {
        if (!row || !Number.isSafeInteger(Number(row.id))) continue;
        const defaults = GENERIC_TABLES[t]?.columns || {};
        put.push({ t, row: { ...structuredClone(defaults), ...row, id: Number(row.id) } });
      }
    }
    await b.write({ put });
    return true;
  } catch {
    return false;
  }
}

async function initialize(b: Backend) {
  if (await b.metaGet("initialized")) return;
  const imported = await importLegacyServerData(b);
  if (!imported) {
    const seed = buildSeed();
    await b.write({ put: Object.entries(seed).flatMap(([t, rows]) => rows.map((row) => ({ t, row }))) });
  }
  await b.metaSet("initialized", { at: iso(), source: imported ? "server-import" : "seed" });
}

/** Opens the browser database and prepares it on the very first visit. */
export function ready(): Promise<Backend> {
  if (!backendPromise) {
    backendPromise = (async () => {
      const b = await openBackend();
      const run = () => initialize(b);
      if (typeof navigator !== "undefined" && navigator.locks?.request) await navigator.locks.request("petit-cahier:init", run);
      else await run();
      // Ask the browser not to evict this data when disk space gets low.
      try { await navigator.storage?.persist?.(); } catch { /* optional */ }
      return b;
    })();
    backendPromise.catch(() => { backendPromise = null; });
  }
  return backendPromise;
}

let chain: Promise<unknown> = Promise.resolve();
/** Serialises every write, across tabs too, so nothing overwrites anything. */
export async function exclusive<T>(fn: (b: Backend) => Promise<T>): Promise<T> {
  const b = await ready();
  try {
    if (typeof navigator !== "undefined" && navigator.locks?.request) {
      return await navigator.locks.request("petit-cahier:write", () => fn(b));
    }
    const run = chain.then(() => fn(b), () => fn(b));
    chain = run.catch(() => undefined);
    return await run;
  } catch (error) {
    throw friendlyError(error);
  }
}

/* ───────── Generic collections (modules, timetable, notebooks, pages…) ───────── */

export async function localList(resource: string): Promise<Row[]> {
  if (!GENERIC_TABLES[resource]) return [];
  const b = await ready();
  return b.all(resource);
}

export function localCreate(resource: string, body: Record<string, unknown>): Promise<Row> {
  const spec = GENERIC_TABLES[resource];
  if (!spec) return Promise.reject(new Error("Espace introuvable."));
  return exclusive(async (b) => {
    for (const field of spec.required || []) {
      if (body[field] === undefined || body[field] === null) throw new Error("Un champ obligatoire est manquant.");
    }
    const row: Row = { id: await b.nextId(resource) };
    for (const [key, fallback] of Object.entries(spec.columns)) row[key] = body[key] !== undefined ? body[key] : structuredClone(fallback);
    row.createdAt = iso();
    if (spec.updatedAt) row.updatedAt = row.createdAt;
    await b.write({ put: [{ t: resource, row }] });
    return row;
  });
}

export function localUpdate(resource: string, id: number, body: Record<string, unknown>): Promise<Row | null> {
  const spec = GENERIC_TABLES[resource];
  if (!spec) return Promise.reject(new Error("Espace introuvable."));
  return exclusive(async (b) => {
    const current = await b.get(resource, id);
    if (!current) return null;
    const next: Row = { ...current };
    for (const key of Object.keys(spec.columns)) if (body[key] !== undefined) next[key] = body[key];
    if (spec.updatedAt) next.updatedAt = iso();
    await b.write({ put: [{ t: resource, row: next }] });
    return next;
  });
}

export function localDelete(resource: string, id: number): Promise<void> {
  if (!GENERIC_TABLES[resource]) return Promise.reject(new Error("Espace introuvable."));
  return exclusive(async (b) => {
    const del: Array<{ t: string; id: number }> = [];
    const collect = async (t: string, rowId: number) => {
      if (del.some((d) => d.t === t && d.id === rowId)) return;
      del.push({ t, id: rowId });
      for (const [child, fk] of CASCADES[t] || []) {
        for (const row of await b.all(child)) if (row[fk] === rowId) await collect(child, row.id);
      }
    };
    await collect(resource, id);
    await b.write({ del });
  });
}

/* ───────── Backup & storage information ───────── */

export async function exportBackup(): Promise<Blob> {
  const b = await ready();
  const tables = await b.dump(ALL_TABLES);
  const payload = { app: "mon-petit-cahier", version: 1, exportedAt: iso(), tables };
  return new Blob([JSON.stringify(payload)], { type: "application/json" });
}

export async function importBackup(file: File): Promise<void> {
  let data: unknown;
  try { data = JSON.parse(await file.text()); } catch { throw new Error("Ce fichier n'est pas une sauvegarde valide."); }
  const payload = data as { app?: string; tables?: Record<string, unknown> };
  if (payload?.app !== "mon-petit-cahier" || !payload.tables || typeof payload.tables !== "object") throw new Error("Ce fichier n'est pas une sauvegarde de Mon petit cahier.");
  const tables: Record<string, Row[]> = {};
  for (const t of ALL_TABLES) {
    const list = payload.tables[t];
    tables[t] = Array.isArray(list) ? list.filter((r): r is Row => Boolean(r) && Number.isSafeInteger(Number((r as Row).id))).map((r) => ({ ...r, id: Number(r.id) })) : [];
  }
  await exclusive((b) => b.replaceAll(tables, { initialized: { at: iso(), source: "backup" } }));
}

export async function storageInfo() {
  const b = await ready();
  let usage = 0, quota = 0, persisted = false;
  try { const estimate = await navigator.storage?.estimate?.(); usage = estimate?.usage || 0; quota = estimate?.quota || 0; } catch { /* optional */ }
  try { persisted = Boolean(await navigator.storage?.persisted?.()); } catch { /* optional */ }
  return { engine: b.kind, usage, quota, persisted };
}
