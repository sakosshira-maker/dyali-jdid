import { friendlyError, localCreate, localDelete, localList, localUpdate } from "./local/store";

export interface Module {
  id: number;
  name: string;
  short: string;
  color: string;
  icon: string;
  teacher: string;
  coefficient: number;
  credits: number;
  description: string;
}

export interface Slot {
  id: number;
  moduleId: number;
  day: number | string;
  startTime: string;
  endTime: string;
  room: string;
  kind: string;
}

export interface Notebook {
  id: number;
  moduleId: number;
  title: string;
  coverColor: string;
  coverIcon: string;
  kind: string;
  coverPattern?: string;
}

export interface Doubt {
  id: number;
  moduleId: number | null;
  question: string;
  answer: string;
  resolved: boolean;
}


// Everything is stored inside the browser (IndexedDB) — no server database.
export async function apiList<T>(resource: string): Promise<T[]> {
  try { return (await localList(resource)) as unknown as T[]; } catch (e) { throw friendlyError(e); }
}

export async function apiCreate<T>(resource: string, body: Record<string, unknown>): Promise<T> {
  return (await localCreate(resource, body)) as unknown as T;
}

export async function apiUpdate<T>(resource: string, id: number | string, body: Record<string, unknown>): Promise<T> {
  return (await localUpdate(resource, Number(id), body)) as unknown as T;
}

export async function apiDelete(resource: string, id: number | string): Promise<void> {
  await localDelete(resource, Number(id));
}
