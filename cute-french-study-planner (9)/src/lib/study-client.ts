import { localStudy } from "./local/study";
const CACHE_PREFIX = "petit-cahier:list:";

/** Last successful list for a space, so a refresh shows your data right away. */
export function readListCache<T>(resource: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + resource);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

function writeListCache(resource: string, data: unknown) {
  try {
    const json = JSON.stringify(data);
    // Small lists only: audio and files stay in IndexedDB, never in localStorage.
    if (json.length > 150_000) window.localStorage.removeItem(CACHE_PREFIX + resource);
    else window.localStorage.setItem(CACHE_PREFIX + resource, json);
  } catch { /* cache is optional */ }
}

export async function studyRequest<T>(resource: string, method = "GET", data?: unknown): Promise<T> {
  let body: T;
  try {
    body = await localStudy<T>(resource, method, data);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "Enregistrement impossible. Réessaie.");
  }
  if (method === "GET") writeListCache(resource, body);
  else window.dispatchEvent(new Event("cahier:activity"));
  return body;
}

export function tellLina(message: string) {
  window.dispatchEvent(new CustomEvent("lina:message", { detail: message }));
}
