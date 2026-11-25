"use client";
// Raah Pro gate. The server decides who has Pro (users.is_pro, or any teacher); there is no payment flow yet.
// A student without Pro sees the feature behind a frosted glass with an "upgrade to unlock" banner,
// so they know what they would get.
import { Icon } from "@/components/icon";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getKV, setKV } from "@/lib/db";
import { PRO_FEATURES, pick } from "@/lib/pro";
import { useApp } from "@/lib/store";

const T: Record<string, Record<string, string>> = {
  en: {
    badge: "PRO", title: "Pro feature — upgrade to unlock",
    text: "This is part of Raah Pro. Ask your teacher or the Raah team to turn on Pro for your account.",
    shelf: "Raah Pro", checking: "Checking your plan…",
  },
  hi: {
    badge: "PRO", title: "प्रो सुविधा — खोलने के लिए अपग्रेड करें",
    text: "यह राह प्रो का हिस्सा है। अपने खाते में प्रो चालू करवाने के लिए अपने शिक्षक या राह टीम से कहें।",
    shelf: "राह प्रो", checking: "आपका प्लान देख रहे हैं…",
  },
  mr: {
    badge: "PRO", title: "प्रो सुविधा — उघडण्यासाठी अपग्रेड करा",
    text: "हे राह प्रो चा भाग आहे. तुमच्या खात्यात प्रो सुरू करण्यासाठी शिक्षकांना किंवा राह टीमला सांगा.",
    shelf: "राह प्रो", checking: "तुमचा प्लान पाहत आहोत…",
  },
};

/** Text for a Pro screen: `useText(DICT)` gives t(key) in the chosen language, English when a key is missing. */
export function useText(dict: Record<string, Record<string, string>>) {
  const { lang } = useApp();
  return (k: string, vars?: Record<string, string | number>) => {
    let s = dict[lang]?.[k] ?? dict.en?.[k] ?? k;
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.replaceAll(`{${a}}`, String(b));
    return s;
  };
}

/** Whether the signed-in user has Pro. Asks the server (the saved sign-in may predate Pro) and remembers the answer offline. */
export function usePro() {
  const { auth, authFetch, online } = useApp();
  const [pro, setPro] = useState<boolean | null>(auth?.user.is_pro ?? null);
  useEffect(() => {
    if (!auth) return;
    let live = true;
    getKV<boolean>(`is_pro_${auth.user.id}`).then((v) => { if (live && v !== undefined) setPro((p) => p ?? v); });
    if (!online) return;
    authFetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((me) => {
      if (!live || !me) return;
      const v = Boolean(me.is_pro);
      setPro(v);
      setKV(`is_pro_${auth.user.id}`, v);
    }).catch(() => {});
    return () => { live = false; };
  }, [auth, authFetch, online]);
  return pro;
}

export function ProBadge() {
  return <span className="rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-2 py-0.5 text-[10px] font-extrabold tracking-wider text-white">PRO</span>;
}

/** Shows `children` to Pro users; everyone else sees a frosted preview under an upgrade banner. */
export function ProGate({ children }: { children: React.ReactNode }) {
  const pro = usePro();
  const t = useText(T);
  if (pro === null) return <div className="py-16 text-center text-sm text-[var(--muted)]">{t("checking")}</div>;
  if (pro) return <>{children}</>;
  return (
    <div className="relative">
      <div aria-hidden inert className="pointer-events-none max-h-[34rem] select-none overflow-hidden opacity-60 blur-[3px]">{children}</div>
      <div className="absolute inset-x-0 top-6 z-10 px-2">
        <div role="alert" className="rounded-2xl bg-[var(--card)] p-5 text-center shadow-xl ring-2 ring-amber-400">
          <div className="text-4xl"></div>
          <div className="mt-2 flex items-center justify-center gap-2"><ProBadge /></div>
          <h2 className="mt-2 text-lg font-bold">{t("title")}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("text")}</p>
          <Link href="/" className="mt-4 block rounded-xl bg-[var(--brand)] py-3 font-semibold text-white">‹ Home</Link>
        </div>
      </div>
    </div>
  );
}

/** The home screen's row of Pro features (nothing is shown until at least one is built). */
export function ProShelf() {
  const { lang } = useApp();
  const t = useText(T);
  if (!PRO_FEATURES.length) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 px-1 text-xs font-semibold text-[var(--muted)]">{t("shelf")} <ProBadge /></div>
      <div className={`grid gap-2 ${PRO_FEATURES.length >= 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {PRO_FEATURES.map((f) => (
          <Link key={f.href} href={f.href}
            className="flex flex-col items-center rounded-2xl bg-gradient-to-b from-amber-50 to-[var(--card)] px-1 py-2 text-center ring-1 ring-amber-300 active:scale-95 dark:from-amber-900/20">
            <Icon name={f.icon} size={24} className="text-[var(--brand)]" />
            <span className="mt-1 text-xs font-semibold leading-tight text-[var(--brand-ink)]">{pick(f.title, lang)}</span>
            <span className="text-[10px] leading-tight text-[var(--muted)]">{pick(f.sub, lang)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
