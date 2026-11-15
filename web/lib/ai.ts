// Calls to the AI chat backend. Every caller has a non-AI fallback, so these never throw.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { API } from "./store";

let statusPromise: Promise<boolean> | null = null;

/** True when the backend has an LLM provider that has not just failed. Checked once per page load. */
export function aiAvailable(): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return Promise.resolve(false);
  if (!statusPromise) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    statusPromise = fetch(`${API}/api/chat/status`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((j) => Boolean(j.available))
      .catch(() => false)
      .finally(() => clearTimeout(timer));
  }
  return statusPromise;
}

/** Forget the cached status, e.g. after a turn fell back because the model stopped answering. */
export function resetAiStatus() { statusPromise = null; }

export async function postAi(path: string, body: unknown): Promise<any | null> {
  try {
    const r = await fetch(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
