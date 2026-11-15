// Audio files for spoken text (BHASHINI TTS), kept in IndexedDB so lessons play offline.
// The cache key is a hash of language + text, so when a dataset edit changes a figure in a
// lesson the old recording is no longer used and the new text is spoken instead.
import { getKV, setKV } from "./db";
import { API } from "./store";

/** FNV-1a; crypto.subtle is unavailable on plain-http LAN addresses, which the demo uses. */
export function textKey(lang: string, text: string) {
  let h = 0x811c9dc5;
  for (const ch of `${lang}|${text}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `audio:${lang}:${h.toString(16)}:${text.length}`;
}

export const cachedAudio = (lang: string, text: string) => getKV<Blob>(textKey(lang, text));

const toBlob = (b64: string, mime: string) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: mime });

/** Generate speech on the server; returns null when BHASHINI is not configured or unreachable. */
export async function fetchAudio(lang: string, text: string, store: boolean): Promise<Blob | null> {
  try {
    const r = await fetch(`${API}/api/voice/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang }) });
    if (!r.ok) return null;
    const j = await r.json();
    const blob = toBlob(j.audio_b64, j.mime);
    if (store) await setKV(textKey(lang, text), blob);
    return blob;
  } catch {
    return null;
  }
}

export async function voiceAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${API}/api/voice/status`);
    return r.ok && Boolean((await r.json()).bhashini);
  } catch {
    return false;
  }
}
