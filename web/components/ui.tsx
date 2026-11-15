"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LANGS, useApp } from "@/lib/store";
import { cachedAudio, fetchAudio } from "@/lib/audio";

export function Shell({ title, back = "/", role = "any", publicPage = false, children }: {
  title?: string; back?: string | null; role?: "any" | "teacher"; publicPage?: boolean; children: React.ReactNode;
}) {
  const { t, online, toast, lang, setLang, data, auth, authReady, signOut } = useApp();
  const router = useRouter();
  const path = usePathname();
  const needsLogin = !publicPage && authReady && !auth;
  useEffect(() => {
    if (needsLogin) router.replace(`/login/?next=${encodeURIComponent(path)}${role === "teacher" ? "&role=teacher" : ""}`);
  }, [needsLogin, path, role, router]);
  const wrongRole = !publicPage && auth && role === "teacher" && auth.user.role !== "teacher";
  const ready = publicPage || (authReady && auth);
  return (
    <div className="mx-auto min-h-screen max-w-md bg-[var(--bg)] pb-24">
      <header className="sticky top-0 z-20 flex items-center gap-2 bg-[var(--brand)] px-4 py-3 text-white shadow">
        {back !== null && (
          <Link href={back} aria-label={t("back")} className="rounded-full px-2 text-2xl leading-none">‹</Link>
        )}
        <h1 className="flex-1 truncate text-lg font-semibold">{title ?? t("app_name")}</h1>
        <select aria-label="language" value={lang} onChange={(e) => setLang(e.target.value)}
          className="rounded bg-white/15 px-2 py-1 text-sm">
          {LANGS.map((l) => <option key={l.code} value={l.code} className="text-black">{l.label}</option>)}
        </select>
        {auth && (
          <button onClick={async () => { await signOut(); router.replace("/login/"); }} title={`${auth.user.name ?? ""} ${auth.user.phone} · ${t("logout")}`}
            className="grid h-8 w-8 place-items-center rounded-full bg-white/15 text-sm font-bold" aria-label={t("logout")}>
            {(auth.user.name || auth.user.role)[0].toUpperCase()}
          </button>
        )}
      </header>
      {!online && <div className="bg-amber-500 px-4 py-2 text-center text-sm font-medium text-black">📴 {t("offline_banner")}</div>}
      <main className="space-y-4 p-4">
        {!ready ? <Loading /> : wrongRole ? (
          <Card>
            <p>🔒 {t("teacher_only")}</p>
            <button onClick={async () => { await signOut(); router.replace(`/login/?next=${encodeURIComponent(path)}&role=teacher`); }}
              className="mt-3 w-full rounded-xl bg-[var(--brand)] py-3 font-semibold text-white">{t("sign_in_teacher")}</button>
          </Card>
        ) : data || publicPage ? children : <Loading />}
      </main>
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black/85 px-5 py-3 text-sm text-white shadow-lg">{toast}</div>
      )}
    </div>
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

/** Text-to-speech: a saved audio file if there is one, then BHASHINI via the backend, else the device voice.
 *  With `cache`, BHASHINI audio is saved on the phone so it plays again offline. */
export function SpeakButton({ text, label, cache }: { text: string; label?: string; cache?: boolean }) {
  const { lang, t, online } = useApp();
  const [on, setOn] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const stop = () => { window.speechSynthesis?.cancel(); audio.current?.pause(); setOn(false); };
  const playBlob = async (b: Blob) => {
    const url = URL.createObjectURL(b);
    audio.current = new Audio(url);
    audio.current.onended = () => { setOn(false); URL.revokeObjectURL(url); };
    await audio.current.play();
  };
  const play = async () => {
    if (on) return stop();
    setOn(true);
    try {
      const saved = await cachedAudio(lang, text);
      const blob = saved ?? (online ? await fetchAudio(lang, text, Boolean(cache)) : null);
      if (blob) return await playBlob(blob);
    } catch { /* fall back */ }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = speechLang(lang);
    u.rate = 0.95;
    u.onend = () => setOn(false);
    window.speechSynthesis?.speak(u);
  };
  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);
  return (
    <button onClick={play} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--brand-soft)] px-3 py-1.5 text-sm font-medium text-[var(--brand-ink)]">
      {on ? "■" : "🔊"} {label ?? (on ? t("stop") : t("play"))}
    </button>
  );
}

/** Speech-to-text with the browser's Web Speech API (BHASHINI ASR is wired on the server for recorded audio). */
export function MicButton({ onText }: { onText: (s: string) => void }) {
  const { lang, t } = useApp();
  const [listening, setListening] = useState(false);
  const SR: any = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
  if (!SR) return null;
  const start = () => {
    const r = new SR();
    r.lang = speechLang(lang);
    r.interimResults = false;
    r.onresult = (e: any) => onText(e.results[0][0].transcript);
    r.onend = () => setListening(false);
    setListening(true);
    r.start();
  };
  return (
    <button onClick={start} aria-label={t("mic")}
      className={`h-12 w-12 shrink-0 rounded-full text-xl text-white shadow ${listening ? "animate-pulse bg-rose-500" : "bg-[var(--brand)]"}`}>
      🎤
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
