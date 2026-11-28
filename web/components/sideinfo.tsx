"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Right-hand column on wide screens, on every student page except Home: the student's career, what Raah did for them
// (same log as the activity page) and a shortcut to ask Raah. It fills the width a laptop has beside a reading column.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { useApp } from "@/lib/store";
import { myCareer } from "@/lib/tailor";
import { BUILD_ROADMAP_HREF } from "@/lib/roadmap";

export function SideInfo({ rows: maxRows = 4 }: { rows?: number } = {}) {
  const { t, data, profile, auth, authFetch } = useApp();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    if (!auth) return;
    authFetch("/api/activity").then((r) => (r.ok ? r.json() : [])).then((j) => Array.isArray(j) && setRows(j.slice(0, maxRows))).catch(() => {});
  }, [auth, authFetch, maxRows]);
  const mine = myCareer(data, profile);
  const name = (id?: string) => data?.careers?.find((c: any) => c.id === id)?.name ?? id ?? "";
  const text = (r: any) => {
    const v = { ...r.vars, ...(r.vars?.career ? { career: name(r.vars.career) } : {}) };
    return r.kind === "today" ? t("act_today", { step: t(r.text_key, v) }) : t(r.text_key, v);
  };
  const box = "rounded-2xl bg-[var(--card)] p-4 shadow-sm ring-1 ring-black/10";
  const label = "text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]";
  return (
    <aside aria-label={t("app_name")} className="hidden w-80 shrink-0 space-y-4 xl:block">
      {mine && (
        <section className={box}>
          <h2 className={label}>{t("your_career")}</h2>
          <p className="mt-1 text-lg font-bold leading-snug">{mine.career.name}</p>
          {!mine.saved && <p className="text-xs text-[var(--muted)]">{t("best_match_note")}</p>}
          <Link href={BUILD_ROADMAP_HREF} className="mt-2 inline-block text-sm font-semibold text-[var(--brand-ink)] underline">{t("change")}</Link>
        </section>
      )}
      {rows.length > 0 && (
        <section className={box}>
          <h2 className={label}>{t("act_title")}</h2>
          <ul className="mt-2 space-y-1.5">
            {rows.map((r) => <li key={r.id} className="rounded-xl bg-[var(--bg)] px-3 py-2 text-sm leading-snug">{text(r)}</li>)}
          </ul>
          <Link href="/activity/" className="mt-2 inline-block text-sm font-semibold text-[var(--brand-ink)] underline">{t("act_open")}</Link>
        </section>
      )}
      <Link href="/ask/" className="flex items-center gap-3 rounded-2xl bg-[var(--brand)] px-4 py-3 text-white shadow-sm active:scale-95">
        <Icon name="chat" size={26} />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold">{t("home_ask")}</span>
          <span className="block truncate text-xs text-white/80">{t("ask_ex1")}</span>
        </span>
        <Icon name="mic" size={18} />
      </Link>
    </aside>
  );
}
