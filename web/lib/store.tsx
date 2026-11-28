"use client";
// App-wide state: dataset (from the spreadsheet), signed-in user, profile, language, online status.
// The dataset is fetched from /api/data, cached in IndexedDB for offline use, and
// re-fetched whenever /api/version reports the spreadsheet was saved.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import en from "@/locales/en.json";
import mr from "@/locales/mr.json";
import hi from "@/locales/hi.json";
import ta from "@/locales/ta.json";
import bn from "@/locales/bn.json";
import te from "@/locales/te.json";
import gu from "@/locales/gu.json";
import kn from "@/locales/kn.json";
import ml from "@/locales/ml.json";
import pa from "@/locales/pa.json";
import or from "@/locales/or.json";
import as from "@/locales/as.json";
import { normalizeLanguage, SELECTABLE_LANGUAGES } from "./languages";
import { db, enqueue, getKV, setKV } from "./db";
import { applySavedA11y } from "./a11y";

export const API = process.env.NEXT_PUBLIC_API_BASE || "";
const LOCALES: Record<string, Record<string, string>> = { en, mr, hi, ta, bn, te, gu, kn, ml, pa, or, as };
export function translateForLanguage(language: string, key: string, vars?: Record<string, string | number>): string {
  let value = LOCALES[normalizeLanguage(language)]?.[key] ?? (en as Record<string, string>)[key] ?? key;
  if (vars) for (const [name, replacement] of Object.entries(vars)) value = value.replaceAll(`{${name}}`, String(replacement));
  return value;
}
const SHORT_LABELS: Record<string, string> = { mr: "मरा", hi: "हिं", en: "Eng" };
const DISPLAY_ORDER = ["mr", "hi", "en"];
export const LANGS = SELECTABLE_LANGUAGES.map((language) => ({
  // short: what the header's language menu shows, to keep the bar uncluttered
  code: language.code,
  label: language.nativeName,
  short: SHORT_LABELS[language.code] ?? language.nativeName,
  speech: language.locale,
})).sort((a, b) => {
  const rank = (code: string) => DISPLAY_ORDER.includes(code) ? DISPLAY_ORDER.indexOf(code) : DISPLAY_ORDER.length;
  return rank(a.code) - rank(b.code);
});

export interface AuthUser { id: number; role: "student" | "teacher"; name: string | null; phone: string; is_pro?: boolean }
interface Auth { token: string; user: AuthUser }

interface Ctx {
  data: any | null;
  profile: any | null;
  setProfile: (p: any) => void;
  lang: string;
  setLang: (l: string) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
  online: boolean;
  toast: string | null;
  showToast: (m: string, ms?: number) => void;
  queueAction: (kind: string, payload: unknown) => Promise<void>;
  refresh: () => Promise<void>;
  auth: Auth | null;
  authReady: boolean;
  signIn: (token: string, user: AuthUser) => Promise<void>;
  signOut: () => Promise<void>;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

const C = createContext<Ctx | null>(null);

/** A new account's profile: just the registered name; the rest is filled in by the Discover chat or My details. */
function blankProfile(user: AuthUser) {
  return { name: user.name ?? "", interests: [], documents: [], exams_passed: [] };
}

export function useApp() {
  const c = useContext(C);
  if (!c) throw new Error("useApp outside provider");
  return c;
}

export function Provider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<any | null>(null);
  const [profile, setProfileState] = useState<any | null>(null);
  const [lang, setLangState] = useState("en");
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [auth, setAuth] = useState<Auth | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const version = useRef<string | null>(null);
  const authRef = useRef<Auth | null>(null);
  authRef.current = auth;

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((m: string, ms = 3500) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  const t = useCallback((k: string, vars?: Record<string, string | number>) => {
    return translateForLanguage(lang, k, vars);
  }, [lang]);

  const signOut = useCallback(async () => {
    setAuth(null);
    // the next person on this phone must not see this person's details
    setProfileState(null);
    await Promise.all([setKV("auth", null), setKV("profile", null), setKV("profile_owner", null)]);
  }, []);

  /** fetch with the signed-in user's token; a 401 from the server signs the user out. */
  const authFetch = useCallback(async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (authRef.current) headers.set("Authorization", `Bearer ${authRef.current.token}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const r = await fetch(`${API}${path}`, { ...init, headers });
    if (r.status === 401 && authRef.current) await signOut();
    return r;
  }, [signOut]);

  const fetchData = useCallback(async (announce: boolean) => {
    try {
      const r = await fetch(`${API}/api/data`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      const changed = version.current && version.current !== d.version.modified;
      version.current = d.version.modified;
      setData(d);
      await setKV("data", d);
      if (announce && changed) showToast(LOCALES[lang]?.dataset_updated ?? "Updated");
    } catch {
      /* offline: keep cached copy */
    }
  }, [lang, showToast]);

  // boot: cached data, session and profile first (instant + offline), then network
  useEffect(() => {
    (async () => {
      const [cached, p, l, a, owner] = await Promise.all([getKV<any>("data"), getKV<any>("profile"), getKV<string>("lang"), getKV<Auth | null>("auth"), getKV<number | null>("profile_owner")]);
      if (cached) { setData(cached); version.current = cached.version?.modified ?? null; }
      // only use the saved profile if it belongs to whoever is signed in (older versions kept a demo student here)
      if (p && a && owner === a.user.id) setProfileState(p);
      else if (a) setProfileState(blankProfile(a.user));
      if (l) setLangState(normalizeLanguage(l));
      if (a) setAuth(a);
      setAuthReady(true);
      setOnline(navigator.onLine);
      await fetchData(false);
    })();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, [fetchData]);

  // teachers preview student screens with the first demo student; students always see their own profile
  useEffect(() => {
    if (data && !profile && auth?.user.role === "teacher" && data.students?.length) setProfileState(data.students[0]);
  }, [data, profile, auth]);

  // live reload: poll the spreadsheet version
  useEffect(() => {
    const id = setInterval(async () => {
      if (!navigator.onLine) return;
      try {
        const r = await fetch(`${API}/api/version`, { cache: "no-store" });
        const v = await r.json();
        if (version.current && v.modified !== version.current) await fetchData(true);
      } catch { /* ignore */ }
    }, 4000);
    return () => clearInterval(id);
  }, [fetchData]);

  const flushQueue = useCallback(async (announce: boolean) => {
    if (!authRef.current || !navigator.onLine) return;
    try {
      const items = await db.queue.toArray();
      if (!items.length) return;
      const r = await authFetch("/api/sync", { method: "POST", body: JSON.stringify(items) });
      if (!r.ok) return;
      await db.queue.bulkDelete(items.map((i) => i.id!));
      if (announce) showToast((LOCALES[lang]?.synced_toast ?? "{n} changes synced").replace("{n}", String(items.length)));
    } catch { /* stay queued */ }
  }, [authFetch, lang, showToast]);

  // online / offline + sync queue flush
  useEffect(() => {
    const on = () => { setOnline(true); flushQueue(true); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [flushQueue]);

  const setProfile = useCallback((p: any) => { setProfileState(p); setKV("profile", p); }, []);
  const setLang = useCallback((l: string) => {
    const code = normalizeLanguage(l);
    setLangState(code);
    setKV("lang", code);
  }, []);
  useEffect(() => { document.title = t("app_title"); }, [t]);
  useEffect(() => { applySavedA11y(); }, []);
  const queueAction = useCallback(async (kind: string, payload: unknown) => {
    await enqueue(kind, payload);
    await flushQueue(false);
  }, [flushQueue]);

  const signIn = useCallback(async (token: string, user: AuthUser) => {
    const a = { token, user };
    setAuth(a);
    authRef.current = a;
    await setKV("auth", a);
    await setKV("profile_owner", user.id);
    let p: any = null;
    try {
      const r = await authFetch("/api/auth/profile");
      p = (await r.json()).profile;
    } catch { /* offline: start from the registered name */ }
    setProfile(p ? { ...p, name: p.name || user.name } : blankProfile(user));
    await flushQueue(false);
  }, [authFetch, flushQueue, setProfile]);

  const value = useMemo(() => ({
    data, profile, setProfile, lang, setLang, t, online, toast, showToast, queueAction, refresh: () => fetchData(true),
    auth, authReady, signIn, signOut, authFetch,
  }), [data, profile, setProfile, lang, setLang, t, online, toast, showToast, queueAction, fetchData, auth, authReady, signIn, signOut, authFetch]);

  return <C.Provider value={value}>{children}</C.Provider>;
}
