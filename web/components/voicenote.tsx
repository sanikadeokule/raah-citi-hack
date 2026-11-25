"use client";
// Turns the parent message into an audio file that can be sent on WhatsApp.
// 1. Server text-to-speech (BHASHINI or Sarvam) when the server has keys (a WAV in the chosen language).
// 2. Otherwise the student records the message in their own voice (browser speech cannot be saved to a file).
// The file is shared through the phone's share sheet, or downloaded where sharing files is not supported.
import { useEffect, useRef, useState } from "react";
import { API, useApp } from "@/lib/store";
import { micErrorKind, micProblem, type VoiceProblem } from "@/lib/audio";

type Clip = { blob: Blob; url: string; ext: string };

const b64ToBlob = (b64: string, mime: string) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: mime });
const recorderMime = () =>
  ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"].find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";

export function VoiceNote({ text, name }: { text: string; name?: string }) {
  const { t, lang, online } = useApp();
  const [clip, setClip] = useState<Clip | null>(null);
  const [state, setState] = useState<"idle" | "making" | "record" | "recording">("idle");
  const [problem, setProblem] = useState<VoiceProblem | null>(null);
  const rec = useRef<MediaRecorder | null>(null);

  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.url); }, [clip]);
  // a new message (other plan, other language) needs a new recording
  useEffect(() => { setClip(null); setState("idle"); setProblem(null); }, [text]);

  const keep = (blob: Blob, ext: string) => setClip({ blob, url: URL.createObjectURL(blob), ext });

  const make = async () => {
    setState("making");
    if (online) {
      try {
        const r = await fetch(`${API}/api/voice/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang }) });
        if (r.ok) {
          const j = await r.json();
          keep(b64ToBlob(j.audio_b64, j.mime), "wav");
          setState("idle");
          return;
        }
      } catch { /* record instead */ }
    }
    setState("record");
  };

  const startRec = async () => {
    setProblem(null);
    const p = micProblem();
    if (p) return setProblem(p);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = recorderMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const parts: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && parts.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const type = r.mimeType || mime || "audio/webm";
        keep(new Blob(parts, { type }), type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm");
        setState("idle");
      };
      rec.current = r;
      r.start();
      setState("recording");
    } catch (e) {
      setProblem(micErrorKind(e));
      setState("record");
    }
  };

  const fileName = () => `raah-parent-note${name ? "-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-") : ""}.${clip!.ext}`;
  const file = () => new File([clip!.blob], fileName(), { type: clip!.blob.type });
  const canShare = () => typeof navigator !== "undefined" && !!navigator.canShare && clip !== null && navigator.canShare({ files: [file()] });
  const share = async () => {
    try { await navigator.share({ files: [file()], text }); } catch { /* cancelled */ }
  };

  return (
    <div className="mt-3 rounded-xl bg-[var(--bg)] p-3">
      <div className="text-sm font-semibold">{t("voice_note")}</div>
      {!clip && state === "idle" && (
        <button onClick={make} className="mt-2 w-full rounded-lg bg-[var(--brand)] py-2 text-sm font-semibold text-white">{t("make_voice_note")}</button>
      )}
      {state === "making" && <p className="mt-2 text-sm text-[var(--muted)]">…</p>}
      {(state === "record" || state === "recording") && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-[var(--muted)]">{t("record_hint")}</p>
          {problem && <p role="alert" className="rounded-lg bg-amber-100 p-2 text-xs text-amber-900">{t(`voice_err_${problem}`)}</p>}
          <button onClick={() => (state === "recording" ? rec.current?.stop() : startRec())}
            className={`w-full rounded-lg py-2 text-sm font-semibold text-white ${state === "recording" ? "animate-pulse bg-[var(--bad)]" : "bg-[var(--accent)]"}`}>
            {state === "recording" ? `${t("stop_recording")}` : `⏺ ${t("record_own")}`}
          </button>
        </div>
      )}
      {clip && (
        <div className="mt-2 space-y-2">
          <audio controls src={clip.url} className="w-full" onError={() => setProblem("play")} />
          {problem === "play" && <p role="alert" className="rounded-lg bg-amber-100 p-2 text-xs text-amber-900">{t("voice_err_play")}</p>}
          <div className="flex gap-2">
            {canShare() && <button onClick={share} className="flex-1 rounded-lg bg-[#25D366] py-2 text-sm font-semibold text-white">{t("share_audio")}</button>}
            <a href={clip.url} download={fileName()} className="flex-1 rounded-lg bg-[var(--card)] py-2 text-center text-sm ring-1 ring-black/10">{t("download_audio")}</a>
            <button onClick={() => { setClip(null); setState("idle"); }} className="rounded-lg px-3 text-sm underline">{t("redo")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
