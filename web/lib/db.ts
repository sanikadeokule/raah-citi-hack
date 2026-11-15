// IndexedDB (Dexie): the dataset cache, profile, consent, quiz answers and the
// offline sync queue all live here so the app keeps working without network.
import Dexie, { type Table } from "dexie";

export interface KV { key: string; value: unknown }
export interface QueueItem { id?: number; kind: string; payload: unknown; at: string }

class RaahDB extends Dexie {
  kv!: Table<KV, string>;
  queue!: Table<QueueItem, number>;
  constructor() {
    super("raah");
    this.version(1).stores({ kv: "key", queue: "++id, kind" });
  }
}

export const db = typeof window !== "undefined" ? new RaahDB() : (null as unknown as RaahDB);

export async function getKV<T>(key: string): Promise<T | undefined> {
  try { return (await db.kv.get(key))?.value as T | undefined; } catch { return undefined; }
}
export async function setKV(key: string, value: unknown) {
  try { await db.kv.put({ key, value }); } catch { /* private mode etc. */ }
}
export async function enqueue(kind: string, payload: unknown) {
  try { await db.queue.add({ kind, payload, at: new Date().toISOString() }); } catch { /* ignore */ }
}
