"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LANGS, useApp } from "@/lib/store";
import { ProfileMenu } from "@/components/profilemenu";
import { Icon } from "@/components/icon";
import { ROADMAP_HREF } from "@/lib/roadmap";
import { cachedAudio, fetchAudio, micErrorKind, micProblem, pickVoice, startRecording, transcribe, voiceStatus, type Recording, type VoiceProblem } from "@/lib/audio";

// the student's main places, shown as a row under the app bar on a big screen (laptop, projector)
const DESK_NAV = [
  { href: "/", key: "nav_home", icon: "home" },
  { href: "/careers/", key: "home_careers", icon: "compass" },
  { href: "/colleges/", key: "home_colleges", icon: "graduation" },
  { href: "/eligibility/", key: "home_eligibility", icon: "rupee" },
  { href: "/exams/", key: "home_exams", icon: "clipboard" },
  { href: "/learn/", key: "home_learn", icon: "book" },
  { href: "/opportunity/", key: "home_opportunity", icon: "briefcase" },
  { href: "/ask/", key: "home_ask", icon: "chat" },
];

/**
 * `fit`: lay the page out to fill one screen (no bottom padding, main is a flex column) so it needs no scrolling.
 * On a big screen (lg and up) the app bar spans the window and the page is centred: a reading width by default,
 * the full desktop width with `wide` (pages that lay themselves out in columns). Phones are unchanged.
 */
export function Shell({ title, back = "/", role = "any", publicPage = false, fit = false, wide = false, children }: {
  title?: string; back?: string | null; role?: "any" | "teacher"; publicPage?: boolean; fit?: boolean; wide?: boolean; children: React.ReactNode;
}) {
  const { t, online, toast, lang, setLang, data, auth, authReady, signOut, profile } = useApp();
  const router = useRouter();
  const path = usePathname();
  const needsLogin = !publicPage && authReady && !auth;
  useEffect(() => {
    if (needsLogin) router.replace(path === "/" ? "/start/" : `/login/?next=${encodeURIComponent(path)}${role === "teacher" ? "&role=teacher" : ""}`);
  }, [needsLogin, path, role, router]);
  const wrongRole = !publicPage && auth && role === "teacher" && auth.user.role !== "teacher";
  const ready = publicPage || (authReady && auth);
  const onRoadmap = (path.endsWith("/") ? path : `${path}/`) === ROADMAP_HREF;
  return (
    <div className={`mx-auto max-w-md bg-(--bg) lg:max-w-none ${fit ? "flex min-h-dvh flex-col" : "min-h-screen pb-24"}`}>
      <div className="sticky top-0 z-20 shadow">
      <header className="bg-(--header-bg) px-4 py-3 text-white">
      <div className="mx-auto flex items-center gap-2 lg:max-w-6xl lg:px-4">
        {back !== null && (
          <Link href={back} aria-label={t("back")} className="rounded-full px-2 text-2xl leading-none">‹</Link>
        )}
        <h1 className="flex flex-1 items-center gap-2 truncate text-lg font-semibold">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-(--saffron)" />
          <span className="truncate">{title ?? t("app_name")}</span>
        </h1>
        {/* a student's own roadmap, one tap from every screen once they have built it */}
        {auth?.user.role === "student" && profile?.roadmap_at && (
          <Link href={ROADMAP_HREF} title={t("my_roadmap")} aria-label={t("my_roadmap")}
            aria-current={onRoadmap ? "page" : undefined}
            className={`grid h-8 w-8 place-items-center rounded-full text-lg active:scale-90 ${onRoadmap ? "bg-white/30 ring-2 ring-(--saffron)" : "bg-white/15"}`}>
            <Icon name="map" size={18} />
          </Link>
        )}
        {/* alerts sit in the top bar for every student */}
        {auth?.user.role === "student" && (
          <Link href="/notifications/" title={t("alerts")} aria-label={t("alerts")}
            className="grid h-8 w-8 place-items-center rounded-full bg-white/15 active:scale-90"><Icon name="bell" size={18} /></Link>
        )}
        <select aria-label={t("language_select")} value={lang} onChange={(e) => setLang(e.target.value)}
          className="h-8 max-w-24 rounded-full bg-white/15 px-2 text-sm font-semibold">
          {LANGS.map((l) => <option key={l.code} value={l.code} title={l.label} className="text-black">{l.label}</option>)}
        </select>
        <ProfileMenu />
      </div>
      </header>
      <div aria-hidden className="tricolour" />
      {auth?.user.role === "student" && (
        <nav aria-label={t("app_name")} className="hidden border-b border-black/10 bg-(--card) lg:block">
          <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-8 py-2">
            {DESK_NAV.map((n) => {
              const here = n.href === "/" ? path === "/" : path.startsWith(n.href.replace(/\/$/, ""));
              return (
                <Link key={n.href} href={n.href} aria-current={here ? "page" : undefined}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold ${here ? "bg-(--brand) text-white" : "text-(--brand-ink) hover:bg-(--brand-soft)"}`}>
                  <Icon name={n.icon} size={16} />{t(n.key)}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
      </div>
      {!online && <div className="bg-amber-500 px-4 py-2 text-center text-sm font-medium text-black"><Icon name="offline" size={16} className="mr-1 align-[-3px]" />{t("offline_banner")}</div>}
      <main className={`${fit ? "flex flex-1 flex-col gap-3 p-3" : "space-y-4 p-4"} lg:mx-auto lg:w-full lg:px-8 lg:py-6 ${wide ? "lg:max-w-6xl" : "lg:max-w-3xl"}`}>
        {!ready ? <Loading /> : wrongRole ? (
          <Card>
            <p><Icon name="lock" size={16} className="mr-1 align-[-3px]" />{t("teacher_only")}</p>
            <button onClick={async () => { await signOut(); router.replace(`/login/?next=${encodeURIComponent(path)}&role=teacher`); }}
              className="mt-3 w-full rounded-xl bg-(--brand) py-3 font-semibold text-white">{t("sign_in_teacher")}</button>
          </Card>
        ) : data || publicPage ? children : <Loading />}
      </main>
      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 w-max max-w-[min(92vw,28rem)] -translate-x-1/2 rounded-2xl bg-black/85 px-5 py-3 text-center text-sm text-white shadow-lg">{toast}</div>
      )}
    </div>
  );
}

function Loading() {
  return <div className="py-20 text-center text-(--muted)">…</div>;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-(--card) p-4 shadow-sm ring-1 ring-black/5 ${className}`}>{children}</section>;
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
    <span className="text-xs text-(--muted)">
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
export function SpeakButton({ text, label, cache, lang: speechLanguage }: { text: string; label?: string; cache?: boolean; lang?: string }) {
  const { lang: appLanguage, t, online, showToast } = useApp();
  const lang = speechLanguage || appLanguage;
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
  const icon = <Icon name={state === "on" ? "stop" : state === "error" ? "warning" : "speaker"} size={16} className="align-[-3px]" />;
  const text_ = label ?? (state === "on" ? t("stop") : state === "error" ? t("voice_retry") : t("play"));
  return (
    <button onClick={play} aria-live="polite" title={state === "error" ? t("voice_err_play") : undefined}
      aria-label={label === "" ? (state === "on" ? t("stop") : state === "error" ? t("voice_retry") : t("play")) : undefined}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium ${state === "error" ? "bg-amber-100 text-amber-900" : "bg-(--brand-soft) text-(--brand-ink)"}`}>
      {icon} {text_}
    </button>
  );
}

/** Voice typing. With a server speech service (BHASHINI or Sarvam) the phone records and the server transcribes,
 *  which works for Marathi on any browser; otherwise the browser's own speech recognition is used.
 *  Every failure (http link, blocked permission, no microphone, nothing heard) is explained in a message. */
export function MicButton({ onText }: { onText: (s: string, detectedLang?: string) => void }) {
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
      const result = await transcribe(lang, await r.stop());
      if (result) onText(result.text, result.lang); else tell("asr");
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
    const status = await voiceStatus(lang);
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
      r.onresult = (e: any) => { heard = true; onText(e.results[0][0].transcript, lang); };
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
      className={`h-12 w-12 shrink-0 rounded-full text-xl text-white shadow ${state === "listening" ? "animate-pulse bg-rose-500" : state === "working" ? "bg-(--muted)" : "bg-(--brand)"}`}>
      {state === "working" ? "…" : <Icon name={state === "listening" ? "stop" : "mic"} size={22} />}
    </button>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl bg-(--bg) p-3">
      <div className="text-xs text-(--muted)">{label}</div>
      <div className={`text-xl font-bold ${tone ?? ""}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-(--muted)">{sub}</div>}
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
