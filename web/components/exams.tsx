"use client";
// Entrance tests and admission rounds from the Exams sheet.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { Card, Source } from "./ui";
import { inr } from "@/lib/engine";
import { useApp } from "@/lib/store";

function WatchButton({ examId }: { examId: string }) {
  const { t, auth, authFetch, online } = useApp();
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!auth || !online) return;
    authFetch("/api/watch/interests").then((r) => (r.ok ? r.json() : [])).then((l) => setOn(l.some((i: any) => i.kind === "exam" && i.ref_id === examId))).catch(() => {});
  }, [auth, authFetch, online, examId]);
  if (!auth || auth.user.role !== "student") return null;
  const toggle = () => {
    const next = !on;
    setOn(next);
    authFetch(`/api/watch/interests/exam/${examId}`, { method: next ? "PUT" : "DELETE" }).catch(() => setOn(!next));
  };
  return (
    <button onClick={toggle} aria-pressed={on} className={`mt-2 rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-[var(--brand)] text-white" : "bg-[var(--brand-soft)] text-[var(--brand-ink)]"}`}>
      {on ? `🔔 ${t("watch_on")}` : `🔔 ${t("watch_off")}`}
    </button>
  );
}

export function examFee(e: any, t: (k: string) => string) {
  if (e.fee_open === null && e.fee_reserved === null) return e.fee_note || "—";
  const part = (v: number | null, k: string) => (v === null ? null : `${v === 0 ? t("free") : inr(v)} ${t(k)}`);
  return [part(e.fee_open, "fee_open"), part(e.fee_reserved, "fee_reserved")].filter(Boolean).join(" · ");
}

export function ExamCard({ e, compact }: { e: any; compact?: boolean }) {
  const { t } = useApp();
  return (
    <div className="rounded-xl bg-[var(--bg)] p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <b>📝 {e.name}</b>
        {e.site && <a href={e.site} target="_blank" rel="noreferrer" className="shrink-0 text-xs underline">{t("official_site")} ↗</a>}
      </div>
      <div className="text-xs text-[var(--muted)]">{e.by}</div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
        {!compact && <><dt className="text-[var(--muted)]">{t("leads_to")}</dt><dd>{e.leads_to}</dd></>}
        <dt className="text-[var(--muted)]">{t("who_can_apply")}</dt><dd>{e.eligibility}</dd>
        <dt className="text-[var(--muted)]">{t("selection")}</dt><dd>{e.selection}</dd>
        <dt className="text-[var(--muted)]">{t("application_fee")}</dt><dd>{examFee(e, t)}{e.fee_note && e.fee_open !== null ? <span className="text-[var(--muted)]"> ({e.fee_note})</span> : null}</dd>
        <dt className="text-[var(--muted)]">{t("when")}</dt><dd>{e.timing}<div className="text-xs text-[var(--muted)]">{e.dates}</div></dd>
      </dl>
      <p className="mt-1 text-xs text-amber-700">{t("check_dates")}</p>
      <WatchButton examId={e.id} />
      <Source url={e.source} date={e.last_checked} />
    </div>
  );
}

export function PlanExams({ plan }: { plan: any }) {
  const { data, t } = useApp();
  const exams = (plan.exams || []).map((id: string) => data.exams?.find((e: any) => e.id === id)).filter(Boolean);
  if (!exams.length) return null;
  return (
    <Card>
      <h2 className="mb-2 text-lg font-bold">📝 {t("exams_for_path")}</h2>
      <div className="space-y-2">{exams.map((e: any) => <ExamCard key={e.id} e={e} compact />)}</div>
    </Card>
  );
}
