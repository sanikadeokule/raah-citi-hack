"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LANGS, useApp } from "@/lib/store";
import { BUILD_ROADMAP_HREF, ROADMAP_HREF, hasRoadmap, openBeforeRoadmap } from "@/lib/roadmap";
import { cachedAudio, fetchAudio, micErrorKind, micProblem, pickVoice, startRecording, transcribe, voiceStatus, type Recording, type VoiceProblem } from "@/lib/audio";

/** `fit`: lay the page out to fill one screen (no bottom padding, main is a flex column) so it needs no scrolling. */
export function Shell({ title, back = "/", role = "any", publicPage = false, fit = false, children }: {
  title?: string; back?: string | null; role?: "any" | "teacher"; publicPage?: boolean; fit?: boolean; children: React.ReactNode;
}) {
  const { t, online, toast, lang, setLang, data, auth, authReady, signOut, profile } = useApp();
  const router = useRouter();
  const path = usePathname();
  const needsLogin = !publicPage && authReady && !auth;
  useEffect(() => {
    if (needsLogin) router.replace(`/login/?next=${encodeURIComponent(path)}${role === "teacher" ? "&role=teacher" : ""}`);
  }, [needsLogin, path, role, router]);
  const wrongRole = !publicPage && auth && role === "teacher" && auth.user.role !== "teacher";
  const ready = publicPage || (authReady && auth);
  // students build a roadmap first; the other features open after that
  const locked = !publicPage && !!auth && !hasRoadmap(profile, auth.user.role) && !openBeforeRoadmap(path);
  const onRoadmap = (path.endsWith("/") ? path : `${path}/`) === ROADMAP_HREF;
  return (
    <div className={`mx-auto max-w-md bg-[var(--bg)] ${fit ? "flex min-h-[100dvh] flex-col" : "min-h-screen pb-24"}`}>
      <div className="sticky top-0 z-20 shadow">
      <header className="flex items-center gap-2 bg-[var(--header-bg)] px-4 py-3 text-white">
        {back !== null && (
          <Link href={back} aria-label={t("back")} className="rounded-full px-2 text-2xl leading-none">‹</Link>
        )}
        <h1 className="flex flex-1 items-center gap-2 truncate text-lg font-semibold">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--saffron)]" />
          <span className="truncate">{title ?? t("app_name")}</span>
        </h1>
        {/* a student's own roadmap, one tap from every screen once they have built it */}
        {auth?.user.role === "student" && profile?.roadmap_at && (
          <Link href={ROADMAP_HREF} title={t("my_roadmap")} aria-label={t("my_roadmap")}
            aria-current={onRoadmap ? "page" : undefined}
            className={`grid h-8 w-8 place-items-center rounded-full text-lg active:scale-90 ${onRoadmap ? "bg-white/30 ring-2 ring-[var(--saffron)]" : "bg-white/15"}`}>
            🗺️
          </Link>
        )}
        <select aria-label="language" value={lang} onChange={(e) => setLang(e.target.value)}
          className="h-8 rounded-full bg-white/15 px-2 text-sm font-semibold">
          {LANGS.map((l) => <option key={l.code} value={l.code} title={l.label} className="text-black">{l.short}</option>)}
        </select>
        {auth && (
          <button onClick={async () => { await signOut(); router.replace("/login/"); }} title={`${auth.user.name ?? ""} ${auth.user.phone} · ${t("logout")}`}
            className="grid h-8 w-8 place-items-center rounded-full bg-white/15 text-sm font-bold" aria-label={t("logout")}>
            {(auth.user.name || auth.user.role)[0].toUpperCase()}
          </button>
        )}
      </header>
      <div aria-hidden className="tricolour" />
      </div>
      {!online && <div className="bg-amber-500 px-4 py-2 text-center text-sm font-medium text-black">📴 {t("offline_banner")}</div>}
      <main className={fit ? "flex flex-1 flex-col gap-3 p-3" : "space-y-4 p-4"}>
        {!ready ? <Loading /> : wrongRole ? (
          <Card>
            <p>🔒 {t("teacher_only")}</p>
            <button onClick={async () => { await signOut(); router.replace(`/login/?next=${encodeURIComponent(path)}&role=teacher`); }}
              className="mt-3 w-full rounded-xl bg-[var(--brand)] py-3 font-semibold text-white">{t("sign_in_teacher")}</button>
          </Card>
        ) : locked ? <RoadmapFirst /> : data || publicPage ? children : <Loading />}
      </main>
      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 w-max max-w-[min(92vw,28rem)] -translate-x-1/2 rounded-2xl bg-black/85 px-5 py-3 text-center text-sm text-white shadow-lg">{toast}</div>
      )}
    </div>
  );
}

/** Shown instead of a feature a student opens before building a roadmap. */
function RoadmapFirst() {
  const { t } = useApp();
  return (
    <Card className="text-center">
      <div className="text-4xl">🗺️</div>
      <h2 className="mt-2 text-lg font-bold">{t("roadmap_first_title")}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{t("roadmap_first_text")}</p>
      <Link href={BUILD_ROADMAP_HREF} className="mt-4 block rounded-xl bg-[var(--brand)] py-3 font-semibold text-white">{t("home_build_roadmap")} →</Link>
    </Card>
  );
}

function Loading() {
  return <div className="py-20 text-center text-[var(--muted)]">…</div>;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-[var(--card)] p-4 shadow-sm ring-1 ring-black/5 ${className}`}>{children}</section>;
}

export function Badge({ tone = "gray", children }: { tone?: "green" | "amber" | "red" | "gray" | "blue"; children: React.ReactNode }) {
  const tones = {
    green: "bg-emerald-100 text-emerald-800", amber: "bg-amber-100 text-amber-900", red: "bg-rose-100 text-rose-800",
    gray: "bg-gray-100 text-gray-700", blue: "bg-sky-100 text-sky-800",
  };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Source({ url, label, date }: { url?: string | null; label?: string; date?: string }) {
  const { t } = useApp();
  if (!url && !label) return null;
  const first = (url || "").split(" ; ")[0];
  let host = "";
  try { host = first ? new URL(first).hostname.replace("www.", "") : ""; } catch { host = first; }
  return (
    <span className="text-xs text-[var(--muted)]">
      {t("source")}:{" "}
      {first ? <a href={first} target="_blank" rel="noreferrer" className="underline">{label || host}</a> : label}
      {date ? ` · ${date}` : ""}
    </span>
  );
}

export function speechLang(lang: string) {
  return LANGS.find((l) => l.code === lang)?.speech || "en-IN";
}

/** Text-to-speech: a saved audio file if there is one, then the server (BHASHINI or Sarvam), else the phone's voice.
 *  With `cache`, server audio is saved on the phone so it plays again offline.
 *  When nothing can be played the button turns into a warning and a message says why. */
export function SpeakButton({ text, label, cache }: { text: string; label?: string; cache?: boolean }) {
  const { lang, t, online, showToast } = useApp();
  const [state, setState] = useState<"idle" | "loading" | "on" | "error">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  // audio fetched but blocked by the browser (no tap in the chain): the next tap plays it straight away
  const ready = useRef<Blob | null>(null);
  const run = useRef(0);
  useEffect(() => { ready.current = null; }, [text, lang]);

  const stop = () => { run.current++; window.speechSynthesis?.cancel(); audio.current?.pause(); setState("idle"); };
  const fail = (k: VoiceProblem, vars?: Record<string, string>) => {
    setState("error");
    showToast(t(`voice_err_${k}`, vars), 8000);
  };
  const playBlob = async (b: Blob) => {
    const url = URL.createObjectURL(b);
    const a = new Audio(url);
    audio.current = a;
    a.onended = () => { setState("idle"); URL.revokeObjectURL(url); };
    await a.play(); // rejects when the browser blocks playback or the file cannot be decoded
    setState("on");
  };
  const speakDevice = async (id: number) => {
    const ss = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    const langName = LANGS.find((l) => l.code === lang)?.label ?? lang;
    if (!ss || typeof SpeechSynthesisUtterance === "undefined") return fail("novoice", { lang: langName });
    const pick = await pickVoice(speechLang(lang));
    if (id !== run.current) return;
    if (!pick) return fail("novoice", { lang: langName });
    if (pick.substitute) showToast(t("voice_hindi_for_marathi"), 5000);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = pick.voice?.lang ?? speechLang(lang);
    if (pick.voice) u.voice = pick.voice;
    u.rate = 0.95;
    let started = false;
    u.onstart = () => { started = true; if (id === run.current) setState("on"); };
    u.onend = () => { if (id === run.current) setState("idle"); };
    u.onerror = (e) => { if (id === run.current && !["interrupted", "canceled"].includes(e.error)) fail("play"); };
    ss.cancel();
    ss.speak(u);
    // some phones accept the request but never speak (no engine, or no audio output)
    setTimeout(() => { if (id === run.current && !started && !ss.speaking) { ss.cancel(); fail("play"); } }, 5000);
  };
  const play = async () => {
    if (state === "on" || state === "loading") return stop();
    const id = ++run.current;
    if (ready.current) {
      const b = ready.current;
      ready.current = null;
      try { return await playBlob(b); } catch { return fail("play"); }
    }
    setState("loading");
    let blob: Blob | null = null;
    try {
      blob = (await cachedAudio(lang, text)) ?? (online ? await fetchAudio(lang, text, Boolean(cache)) : null);
    } catch { /* use the phone's voice */ }
    if (id !== run.current) return;
    if (blob) {
      try { return await playBlob(blob); } catch (e) {
        if ((e as DOMException)?.name === "NotAllowedError") {
          ready.current = blob;
          setState("error");
          return showToast(t("voice_tap_again"), 5000);
        }
        /* file could not be played: try the phone's voice */
      }
    }
    speakDevice(id);
  };
  useEffect(() => () => { window.speechSynthesis?.cancel(); audio.current?.pause(); }, []);
  const icon = state === "on" ? "■" : state === "loading" ? "…" : state === "error" ? "⚠️" : "🔊";
  const text_ = label ?? (state === "on" ? t("stop") : state === "error" ? t("voice_retry") : t("play"));
  return (
    <button onClick={play} aria-live="polite" title={state === "error" ? t("voice_err_play") : undefined}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium ${state === "error" ? "bg-amber-100 text-amber-900" : "bg-[var(--brand-soft)] text-[var(--brand-ink)]"}`}>
      {icon} {text_}
    </button>
  );
}

/** Voice typing. With a server speech service (BHASHINI or Sarvam) the phone records and the server transcribes,
 *  which works for Marathi on any browser; otherwise the browser's own speech recognition is used.
 *  Every failure (http link, blocked permission, no microphone, nothing heard) is explained in a message. */
export function MicButton({ onText }: { onText: (s: string) => void }) {
  const { lang, t, showToast } = useApp();
  const [state, setState] = useState<"idle" | "listening" | "working">("idle");
  const rec = useRef<Recording | null>(null);
  const sr = useRef<any>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tell = (k: VoiceProblem) => showToast(t(`voice_err_${k}`), 8000);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); sr.current?.abort?.(); rec.current?.stop().catch(() => {}); }, []);

  const finish = async () => {
    if (timer.current) clearTimeout(timer.current);
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    setState("working");
    try {
      const text = await transcribe(lang, await r.stop());
      if (text) onText(text); else tell("asr");
    } catch {
      tell("asr");
    } finally {
      setState("idle");
    }
  };

  const click = async () => {
    if (state === "working") return;
    if (state === "listening") {
      if (rec.current) return finish();
      sr.current?.stop();
      return;
    }
    const problem = micProblem();
    if (problem === "insecure") return tell("insecure");
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const status = await voiceStatus();
    if (status.asr && !problem && typeof MediaRecorder !== "undefined") {
      try {
        rec.current = await startRecording();
      } catch (e) {
        return tell(micErrorKind(e));
      }
      setState("listening");
      showToast(t("voice_listening"), 4000);
      timer.current = setTimeout(finish, 15000);
      return;
    }
    if (SR) {
      const r = new SR();
      sr.current = r;
      r.lang = speechLang(lang);
      r.interimResults = false;
      let heard = false;
      r.onresult = (e: any) => { heard = true; onText(e.results[0][0].transcript); };
      r.onerror = (e: any) => { if (e.error !== "aborted") { heard = true; tell(micErrorKind(e)); } };
      r.onend = () => { if (timer.current) clearTimeout(timer.current); setState("idle"); if (!heard) tell("nospeech"); };
      try {
        r.start();
        setState("listening");
        timer.current = setTimeout(() => r.abort?.(), 15000); // some phones never end on their own
      } catch (e) {
        tell(micErrorKind(e));
      }
      return;
    }
    tell("unsupported");
  };

  return (
    <button onClick={click} aria-label={state === "listening" ? t("voice_listening") : t("mic")} aria-pressed={state === "listening"}
      className={`h-12 w-12 shrink-0 rounded-full text-xl text-white shadow ${state === "listening" ? "animate-pulse bg-rose-500" : state === "working" ? "bg-[var(--muted)]" : "bg-[var(--brand)]"}`}>
      {state === "working" ? "…" : state === "listening" ? "⏹" : "🎤"}
    </button>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl bg-[var(--bg)] p-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className={`text-xl font-bold ${tone ?? ""}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

export const STATUS_TONE: Record<string, "green" | "amber" | "red" | "gray"> = {
  eligible: "green", eligible_missing_docs: "amber", need_info: "gray", not_eligible: "red",
};

export const DOC_LABEL: Record<string, string> = {
  income_certificate: "Income certificate", caste_certificate: "Caste certificate", domicile_certificate: "Domicile certificate",
  marksheet_7: "Class 7 marksheet", marksheet_10: "Class 10 marksheet", marksheet_12: "Class 12 marksheet",
  school_bonafide: "School bonafide certificate", bank_passbook: "Bank passbook (Aadhaar-seeded)", occupation_certificate: "Parent occupation certificate",
  disability_certificate: "Disability certificate (UDID)", admission_letter: "Admission letter", cap_document: "CAP admission document",
  hostel_proof: "Hostel / rent proof", aadhaar: "Aadhaar",
};
export const docLabel = (d: string) => DOC_LABEL[d] ?? d.replaceAll("_", " ");
