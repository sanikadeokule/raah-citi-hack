"use client";
// Entrance tests and admission rounds from the Exams sheet.
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, Source } from "./ui";
import { inr } from "@/lib/engine";
import { useApp } from "@/lib/store";

// The signed-in student's followed exams, shared by every card on the screen.
let followed: { token: string; ids: Set<string> } | null = null;
let followsLoading: string | null = null;
const followListeners = new Set<() => void>();
const followsChanged = () => followListeners.forEach((l) => l());

function FollowExam({ id }: { id: string }) {
  const { t, auth, authFetch, online, showToast } = useApp();
  const [, redraw] = useState(0);

  useEffect(() => {
    const listener = () => redraw((n) => n + 1);
    followListeners.add(listener);
    return () => { followListeners.delete(listener); };
  }, []);

  const token = auth?.token;
  useEffect(() => {
    if (!token || !online || followed?.token === token || followsLoading === token) return;
    followsLoading = token;
    authFetch("/api/exams/following")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) { followed = { token, ids: new Set(j.exam_ids) }; followsChanged(); } })
      .catch(() => {})
      .finally(() => { followsLoading = null; });
  }, [token, online, authFetch]);

  const style = "rounded-full px-3 py-1 text-xs font-semibold";
  if (!token) return <Link href="/login/" className={`${style} bg-[var(--brand-soft)] text-[var(--brand-ink)]`}>🔔 {t("exam_follow")}</Link>;

  const ids = followed?.token === token ? followed.ids : null;
  const on = !!ids?.has(id);
  const toggle = async () => {
    if (!ids) return;
    const flip = (value: boolean) => { if (value) ids.add(id); else ids.delete(id); followsChanged(); };
    flip(!on);
    try {
      const r = await authFetch(`/api/exams/${id}/follow`, { method: on ? "DELETE" : "PUT" });
      if (!r.ok) throw new Error(String(r.status));
      if (!on) showToast(t("exam_follow_done"));
    } catch {
      flip(on);
      showToast(t("exam_follow_failed"));
    }
  };
  return (
    <button onClick={toggle} disabled={!ids || !online} aria-pressed={on}
      className={`${style} disabled:opacity-50 ${on ? "bg-[var(--brand)] text-white" : "bg-[var(--brand-soft)] text-[var(--brand-ink)]"}`}>
      {on ? `✓ ${t("exam_following")}` : `🔔 ${t("exam_follow")}`}
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
      <div className="mt-2"><FollowExam id={e.id} /></div>
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
