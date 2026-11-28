"use client";
// Raah Pro gate. The server decides who has Pro (users.is_pro, or any teacher); there is no payment flow yet.
// A student without Pro sees the feature behind a frosted glass with an "upgrade to unlock" banner,
// so they know what they would get.
import { Icon } from "@/components/icon";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getKV, setKV } from "@/lib/db";
import { PRO_FEATURES } from "@/lib/pro";
import { useApp } from "@/lib/store";


/** Screen-local key names, resolved through the shared catalog and its English fallback. */
export function useText(prefix: string) {
  const { t } = useApp();
  return (key: string, vars?: Record<string, string | number>) => t(`${prefix}${key}`, vars);
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
  return <span className="rounded-full bg-linear-to-r from-amber-400 to-orange-500 px-2 py-0.5 text-[10px] font-extrabold tracking-wider text-white">PRO</span>;
}

/** Shows `children` to Pro users; everyone else sees a frosted preview under an upgrade banner. */
export function ProGate({ children }: { children: React.ReactNode }) {
  const pro = usePro();
  const t = useText("pro_gate_");
  if (pro === null) return <div className="py-16 text-center text-sm text-(--muted)">{t("checking")}</div>;
  if (pro) return <>{children}</>;
  return (
    <div className="relative">
      <div aria-hidden inert className="pointer-events-none max-h-136 select-none overflow-hidden opacity-60 blur-[3px]">{children}</div>
      <div className="absolute inset-x-0 top-6 z-10 px-2">
        <div role="alert" className="rounded-2xl bg-(--card) p-5 text-center shadow-xl ring-2 ring-amber-400">
          <div className="text-4xl"></div>
          <div className="mt-2 flex items-center justify-center gap-2"><ProBadge /></div>
          <h2 className="mt-2 text-lg font-bold">{t("title")}</h2>
          <p className="mt-1 text-sm text-(--muted)">{t("text")}</p>
          <Link href="/" className="mt-4 block rounded-xl bg-(--brand) py-3 font-semibold text-white">‹ {t("home")}</Link>
        </div>
      </div>
    </div>
  );
}

/** The home screen's row of Pro features (nothing is shown until at least one is built). */
export function ProShelf({ grow = false }: { grow?: boolean } = {}) {
  const { t } = useApp();
  if (!PRO_FEATURES.length) return null;
  return (
    <div className={grow ? "flex flex-col gap-1 xl:flex-[0.5]" : "space-y-1"}>
      <div className="flex items-center gap-2 px-1 text-xs font-semibold text-(--muted)">{t("pro_gate_shelf")} <ProBadge /></div>
      <div className={`grid gap-2 ${grow ? "xl:flex-1" : ""} ${PRO_FEATURES.length >= 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {PRO_FEATURES.map((f) => (
          <Link key={f.href} href={f.href}
            className="flex flex-col items-center justify-center rounded-2xl bg-linear-to-b from-amber-50 to-(--card) px-1 py-2 text-center ring-1 ring-amber-300 active:scale-95 dark:from-amber-900/20">
            <Icon name={f.icon} size={24} className="text-(--brand)" />
            <span className="mt-1 text-xs font-semibold leading-tight text-(--brand-ink)">{t(f.titleKey)}</span>
            <span className="text-[10px] leading-tight text-(--muted)">{t(f.subKey)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
