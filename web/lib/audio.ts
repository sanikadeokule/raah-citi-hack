// Speech in the browser: audio files from the server (BHASHINI or Sarvam), kept in IndexedDB so
// lessons play offline; the phone's own voices as a fallback; and microphone recording for voice typing.
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

/** Generate speech on the server; returns null when no speech service is configured or reachable. */
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

export type VoiceStatus = { tts: boolean; asr: boolean; providers: string[] };
const statusCache = new Map<string, Promise<VoiceStatus>>();

/** Which server speech services have keys (asked once per page load). */
export function voiceStatus(lang = "en"): Promise<VoiceStatus> {
  if (!statusCache.has(lang)) statusCache.set(lang, fetch(`${API}/api/voice/status?lang=${encodeURIComponent(lang)}`)
    .then(async (r) => (r.ok ? ((await r.json()) as VoiceStatus) : { tts: false, asr: false, providers: [] }))
    .catch(() => ({ tts: false, asr: false, providers: [] })));
  return statusCache.get(lang)!;
}

export const voiceAvailable = async (lang: string) => (await voiceStatus(lang)).tts;

// ------------------------------------------------------------------ problems the student is told about
/** Keys of the messages in locales/*.json (voice_err_<key>). */
export type VoiceProblem = "insecure" | "denied" | "nomic" | "unsupported" | "nospeech" | "asr" | "play" | "novoice";

/** Phone browsers only allow the microphone on https pages or localhost. */
export function micProblem(): VoiceProblem | null {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
  return null;
}

export function micErrorKind(e: unknown): VoiceProblem {
  const name = (e as { name?: string })?.name ?? (e as { error?: string })?.error ?? "";
  if (["NotAllowedError", "SecurityError", "PermissionDeniedError", "not-allowed", "service-not-allowed"].includes(name)) return "denied";
  if (["NotFoundError", "DevicesNotFoundError", "NotReadableError", "audio-capture"].includes(name)) return "nomic";
  if (name === "no-speech") return "nospeech";
  return "asr";
}

// ------------------------------------------------------------------ recording for server speech-to-text
const recorderMime = () =>
  ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"].find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";

/** 16 kHz mono 16-bit WAV, which both BHASHINI and Sarvam accept. */
export function encodeWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 0x7fff, true));
  return new Blob([buf], { type: "audio/wav" });
}

async function toWav16k(blob: Blob): Promise<Blob> {
  const AC: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AC();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    return encodeWav((await off.startRendering()).getChannelData(0), 16000);
  } finally {
    ctx.close();
  }
}

export type Recording = { stop: () => Promise<Blob> };

/** Starts the microphone; stop() returns the speech as a 16 kHz WAV. Throws a DOMException when the mic is blocked. */
export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const mime = recorderMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  rec.start();
  return {
    stop: () => new Promise<Blob>((resolve, reject) => {
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        toWav16k(new Blob(parts, { type: rec.mimeType || mime || "audio/webm" })).then(resolve, reject);
      };
      rec.stop();
    }),
  };
}

const blobToB64 = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});

/** Server speech-to-text; null when the service failed or heard nothing. */
export async function transcribe(lang: string, wav: Blob): Promise<{ text: string; lang: string } | null> {
  try {
    const r = await fetch(`${API}/api/voice/asr`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_b64: await blobToB64(wav), lang, sample_rate: 16000, format: "wav" }),
    });
    if (!r.ok) return null;
    const result = await r.json();
    const text = (result.text as string)?.trim();
    return text ? { text, lang: result.detected_lang || lang } : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ the phone's own voices
/** Voices load asynchronously on Android/Chrome, so wait briefly for the list. */
export async function deviceVoices(): Promise<SpeechSynthesisVoice[]> {
  const ss = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (!ss) return [];
  let v = ss.getVoices();
  if (v.length) return v;
  await new Promise<void>((res) => {
    const done = () => { ss.removeEventListener?.("voiceschanged", done); res(); };
    ss.addEventListener?.("voiceschanged", done);
    setTimeout(done, 1500);
  });
  return ss.getVoices();
}

/** A matching device voice; Marathi can explicitly substitute Hindi. */
export async function pickVoice(speechLang: string): Promise<{ voice?: SpeechSynthesisVoice; substitute?: string } | null> {
  const all = await deviceVoices();
  if (!all.length) return speechLang.toLowerCase().startsWith("en") ? {} : null;
  const norm = (l: string) => l.replace("_", "-").toLowerCase();
  const base = speechLang.slice(0, 2).toLowerCase();
  const exact = all.find((v) => norm(v.lang) === speechLang.toLowerCase()) ?? all.find((v) => norm(v.lang).startsWith(base));
  if (exact) return { voice: exact };
  if (base === "mr") {
    const hi = all.find((v) => norm(v.lang).startsWith("hi"));
    if (hi) return { voice: hi, substitute: "hi" };
  }
  return null;
}
