"use client";
// "What Raah did for you": every action the agent took for this student, newest first, in their language.
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { Shell } from "@/components/ui";
import { useApp } from "@/lib/store";

const ICON: Record<string, string> = { today: "compass", ask: "chat", learned: "check", chose: "map" };

export default function Activity() {
  const { t, data, auth, authFetch, lang } = useApp();
  const [rows, setRows] = useState<any[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!auth) return;
    authFetch("/api/activity").then((r) => (r.ok ? r.json() : Promise.reject())).then(setRows).catch(() => setFailed(true));
  }, [auth, authFetch]);

  const name = (id?: string) => data?.careers?.find((c: any) => c.id === id)?.name ?? id ?? "";
  const text = (r: any) => {
    const v = { ...r.vars, ...(r.vars?.career ? { career: name(r.vars.career) } : {}) };
    return r.kind === "today" ? t("act_today", { step: t(r.text_key, v) }) : t(r.text_key, v);
  };
  const when = (s: number) => new Date(s * 1000).toLocaleString(lang === "en" ? "en-IN" : lang === "hi" ? "hi-IN" : "mr-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  return (
    <Shell>
      <div><h2 className="text-2xl font-extrabold text-[var(--brand-ink)]">{t("act_title")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("act_intro")}</p></div>
      {failed && <p className="rounded-2xl bg-[var(--card)] p-4 text-sm ring-1 ring-black/10">{t("act_offline")}</p>}
      {rows && rows.length === 0 && <p className="rounded-2xl bg-[var(--card)] p-4 text-sm ring-1 ring-black/10">{t("act_empty")}</p>}
      <ol className="space-y-2">
        {(rows ?? []).map((r) => (
          <li key={r.id} className="flex items-start gap-3 rounded-2xl bg-[var(--card)] p-3.5 ring-1 ring-black/10">
            <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Icon name={ICON[r.kind] ?? "check"} size={18} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug">{text(r)}</p>
              <p className="mt-0.5 text-[11px] text-[var(--muted)]">{when(r.created_at)}</p>
              {r.href && <Link href={r.href} className="mt-1 inline-block text-xs font-bold text-[var(--brand-ink)] underline">{t("act_open")}</Link>}
            </div>
          </li>
        ))}
      </ol>
    </Shell>
  );
}
