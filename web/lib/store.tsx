"use client";
// App-wide state: dataset (from the spreadsheet), profile, language, online status.
// The dataset is fetched from /api/data, cached in IndexedDB for offline use, and
// re-fetched whenever /api/version reports the spreadsheet was saved.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import en from "@/locales/en.json";
import mr from "@/locales/mr.json";
import hi from "@/locales/hi.json";
import { db, enqueue, getKV, setKV } from "./db";

export const API = process.env.NEXT_PUBLIC_API_BASE || "";
const LOCALES: Record<string, Record<string, string>> = { en, mr, hi };
export const LANGS = [
  { code: "mr", label: "मराठी", speech: "mr-IN" },
  { code: "hi", label: "हिन्दी", speech: "hi-IN" },
  { code: "en", label: "English", speech: "en-IN" },
];

interface Ctx {
  data: any | null;
  profile: any | null;
  setProfile: (p: any) => void;
  lang: string;
  setLang: (l: string) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
  online: boolean;
  toast: string | null;
  showToast: (m: string) => void;
  queueAction: (kind: string, payload: unknown) => Promise<void>;
  refresh: () => Promise<void>;
}

const C = createContext<Ctx | null>(null);

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
  const version = useRef<string | null>(null);

  const showToast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const t = useCallback((k: string, vars?: Record<string, string | number>) => {
    let s = LOCALES[lang]?.[k] ?? (en as Record<string, string>)[k] ?? k;
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.replaceAll(`{${a}}`, String(b));
    return s;
  }, [lang]);

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

  // boot: cached data first (instant + offline), then network
  useEffect(() => {
    (async () => {
      const [cached, p, l] = await Promise.all([getKV<any>("data"), getKV<any>("profile"), getKV<string>("lang")]);
      if (cached) { setData(cached); version.current = cached.version?.modified ?? null; }
      if (p) setProfileState(p);
      if (l) setLangState(l);
      setOnline(navigator.onLine);
      await fetchData(false);
    })();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, [fetchData]);

  // default profile = first demo student from the spreadsheet
  useEffect(() => {
    if (data && !profile && data.students?.length) setProfileState(data.students[0]);
  }, [data, profile]);

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

  // online / offline + sync queue flush
  useEffect(() => {
    const flush = async () => {
      setOnline(true);
      try {
        const items = await db.queue.toArray();
        if (!items.length) return;
        await fetch(`${API}/api/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(items) }).catch(() => null);
        await db.queue.clear();
        showToast((LOCALES[lang]?.synced_toast ?? "{n} changes synced").replace("{n}", String(items.length)));
      } catch { /* ignore */ }
    };
    const off = () => setOnline(false);
    window.addEventListener("online", flush);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", flush); window.removeEventListener("offline", off); };
  }, [lang, showToast]);

  const setProfile = useCallback((p: any) => { setProfileState(p); setKV("profile", p); }, []);
  const setLang = useCallback((l: string) => { setLangState(l); setKV("lang", l); }, []);
  const queueAction = useCallback(async (kind: string, payload: unknown) => {
    await enqueue(kind, payload);
    if (navigator.onLine) {
      const items = await db.queue.toArray();
      await fetch(`${API}/api/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(items) }).then(() => db.queue.clear()).catch(() => null);
    }
  }, []);

  const value = useMemo(() => ({
    data, profile, setProfile, lang, setLang, t, online, toast, showToast, queueAction, refresh: () => fetchData(true),
  }), [data, profile, setProfile, lang, setLang, t, online, toast, showToast, queueAction, fetchData]);

  return <C.Provider value={value}>{children}</C.Provider>;
}
