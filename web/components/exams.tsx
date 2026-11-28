"use client";
// Entrance tests and admission rounds from the Exams sheet.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Icon } from "@/components/icon";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card, Source } from "./ui";
import { inr } from "@/lib/engine";
import { Pager, usePaged } from "./pager";
import { useApp } from "@/lib/store";
import { examsForStudent, myCareer } from "@/lib/tailor";

function WatchButton({ examId, inline = false }: { examId: string; inline?: boolean }) {
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
    <button onClick={toggle} aria-pressed={on} className={`${inline ? "" : "mt-2 "}rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-[var(--brand)] text-white" : "bg-[var(--brand-soft)] text-[var(--brand-ink)]"}`}>
      {on ? `${t("watch_on")}` : `${t("watch_off")}`}
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
        <b>{e.name}</b>
        {e.site && <a href={e.site} target="_blank" rel="noreferrer" className="shrink-0 text-xs underline">{t("official_site")} </a>}
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

export function ExamTile({ e, paths = [], reason }: { e: any; paths?: any[]; reason?: { key: string; vars?: Record<string, any> } | null }) {
  const { t } = useApp();
  const fact = (icon: string, label: string, value: React.ReactNode) => (
    <div className="flex items-start gap-2.5 rounded-xl bg-[var(--bg)] p-2.5">
      <Icon name={icon} size={20} className="text-[var(--brand)]" />
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</div>
        <div className="text-sm font-medium leading-snug">{value}</div>
      </div>
    </div>
  );
  return (
    <details className="group rounded-2xl bg-[var(--card)] shadow-sm ring-1 ring-black/5">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]"><Icon name="clipboard" size={22} /></span>
        <span className="min-w-0 flex-1 font-bold leading-snug">{e.name}{reason && <span className="mt-1 block text-[11px] font-medium text-[var(--brand-ink)]">{t(reason.key, reason.vars)}</span>}</span>
        <span aria-hidden className="text-lg text-[var(--muted)] transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="space-y-2.5 border-t border-black/5 p-3.5 pt-3">
        <div className="text-xs text-[var(--muted)]">{e.by}</div>
        <div className="grid gap-2">
          {fact("graduation", t("who_can_apply"), <span className="line-clamp-2">{e.eligibility}</span>)}
          {fact("rupee", t("application_fee"), examFee(e, t))}
          {fact("calendar", t("when"), e.timing)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {e.site && <a href={e.site} target="_blank" rel="noreferrer" className="rounded-full bg-[var(--brand)] px-3 py-1 text-xs font-semibold text-white">{t("official_site")} </a>}
          <WatchButton examId={e.id} inline />
          {paths.map((p: any) => <Link key={p.id} href={`/plan/?id=${p.id}`} className="rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-ink)]">₹ {p.label}</Link>)}
        </div>
        <details className="group/more text-xs">
          <summary className="cursor-pointer list-none font-semibold text-[var(--brand-ink)]">{t("more_details")} <span aria-hidden className="inline-block transition-transform group-open/more:rotate-90">›</span></summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
            {e.leads_to && <><dt className="text-[var(--muted)]">{t("leads_to")}</dt><dd>{e.leads_to}</dd></>}
            <dt className="text-[var(--muted)]">{t("selection")}</dt><dd>{e.selection}</dd>
            {e.dates && <><dt className="text-[var(--muted)]">{t("when")}</dt><dd>{e.dates}</dd></>}
          </dl>
          <p className="mt-1.5 text-amber-700">{t("check_dates")}</p>
          <Source url={e.source} date={e.last_checked} />
        </details>
      </div>
    </details>
  );
}

export function ExamsList() {
  const { data, t, profile } = useApp();
  // the student's own path first: exams for the career they saved (else Raah's best match), with the reason
  const rows = useMemo(() => examsForStudent(data, profile), [data, profile]);
  const mineCount = rows.filter((r) => r.mine).length;
  const [tab, setTab] = useState<"you" | "all">("you");
  const shown = tab === "you" ? rows.filter((r) => r.mine) : rows;
  // which cost plans use each exam, so a student can jump from the exam to the path
  const usedBy = (id: string) => (data?.plans || []).filter((p: any) => (p.exams || []).includes(id));
  const pg = usePaged(shown, 5, `exams|${tab}`);
  return (
    <>
      <Card><p className="text-sm text-[var(--muted)]">{t("exams_intro")}</p></Card>
      <div className="flex gap-2" role="tablist" aria-label={t("exams_for_you_intro")}>
        {([["you", t("for_you_tab")], ["all", t("all_tab")]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold ${tab === k ? "bg-[var(--brand)] text-white" : "bg-[var(--card)] ring-1 ring-black/10"}`}>{label}{k === "you" ? ` (${mineCount})` : ` (${rows.length})`}</button>
        ))}
      </div>
      <div ref={pg.top} />
      {tab === "you" && mineCount === 0
        ? <Card>
            {profile?.class && !myCareer(data, profile)
              ? <div className="flex flex-wrap items-center gap-3">
                  <p className="min-w-0 flex-1 text-sm text-[var(--muted)]">{t("exams_pick_career")}</p>
                  <Link href="/roadmap/" className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white">{t("exams_pick_career_btn")}</Link>
                </div>
              : <p className="text-sm text-[var(--muted)]">{profile?.class ? t("exams_none_for_you") : t("exams_need_profile")}</p>}
          </Card>
        : <div className="space-y-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
            {pg.pageItems.map((r) => <ExamTile key={r.item.id} e={r.item} paths={usedBy(r.item.id)} reason={tab === "you" ? r.reason : null} />)}
          </div>}
      {tab === "you" && <button onClick={() => setTab("all")} className="w-full text-center text-sm font-semibold text-[var(--brand-ink)] underline">{t("see_all")}</button>}
      <Pager {...pg} shown={pg.pageItems.length} />
    </>
  );
}

export function PlanExams({ plan }: { plan: any }) {
  const { data, t } = useApp();
  const exams = (plan.exams || []).map((id: string) => data.exams?.find((e: any) => e.id === id)).filter(Boolean);
  if (!exams.length) return null;
  return (
    <Card>
      <h2 className="mb-2 text-lg font-bold">{t("exams_for_path")}</h2>
      <div className="space-y-2">{exams.map((e: any) => <ExamCard key={e.id} e={e} compact />)}</div>
    </Card>
  );
}
