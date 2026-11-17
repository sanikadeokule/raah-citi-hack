"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { Card, Shell } from "@/components/ui";
import { SchemeResult } from "@/components/plan";
import { eligibility, eligibilityChanges, inr } from "@/lib/engine";
import { useApp } from "@/lib/store";
import { Pager, usePaged } from "@/components/pager";
import { Tabs } from "@/components/tabs";

const PAGE = 5;
const STATUSES = ["eligible", "eligible_missing_docs", "need_info", "not_eligible"] as const;
type Status = (typeof STATUSES)[number];
const STATUS_ICON: Record<Status, string> = { eligible: "✅", eligible_missing_docs: "📄", need_info: "❔", not_eligible: "❌" };

export default function EligibilityPage() {
  const { data, profile, t } = useApp();
  const [planId, setPlanId] = useState<string>("");
  const [hostel, setHostel] = useState<boolean | undefined>(undefined);
  const [focus, setFocus] = useState<string | null>(null);
  // a teacher's recommendation links here with ?scheme=…&plan=…; show that scheme first and open
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("plan")) setPlanId(q.get("plan")!);
    setFocus(q.get("scheme"));
  }, []);
  const plan = useMemo(() => data?.plans.find((p: any) => p.id === planId), [data, planId]);
  const list = useMemo(() => {
    if (!data || !profile) return [];
    const all = eligibility(data, profile, plan, hostel);
    return focus ? [...all.filter((e: any) => e.id === focus), ...all.filter((e: any) => e.id !== focus)] : all;
  }, [data, profile, plan, hostel, focus]);
  // what this plan changes against "now": most schemes depend on the student, not the course, so say it plainly
  const changes = useMemo(() => (data && profile && plan ? eligibilityChanges(data, profile, plan, hostel) : null), [data, profile, plan, hostel]);
  const counts = list.reduce((a: any, e: any) => ({ ...a, [e.status]: (a[e.status] || 0) + 1 }), {});
  const exams = (plan?.exams || []).map((id: string) => data?.exams?.find((x: any) => x.id === id)?.name).filter(Boolean);
  const changedIds = new Set((changes?.changed || []).map((c: any) => c.id));
  const forCourse = new Set(changes?.for_this_course || []);
  // one status group at a time; open on the recommended scheme's group, else the best non-empty one
  const [picked, setPicked] = useState<Status | null>(null);
  const focusStatus = focus ? list.find((e: any) => e.id === focus)?.status : undefined;
  const status: Status = picked ?? focusStatus ?? STATUSES.find((s) => counts[s]) ?? "eligible";
  const shown = useMemo(() => list.filter((e: any) => e.status === status), [list, status]);
  const pg = usePaged(shown, PAGE, `${planId}|${hostel}|${focus}|${status}`);
  return (
    <Shell title={t("eligibility")}>
      <Card>
        <label className="text-sm">{t("plan_for")}:
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="ml-2 rounded bg-[var(--bg)] p-1">
            <option value="">Now (Class {profile?.class})</option>
            {data?.plans.map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        {plan && (
          <div className="mt-2 rounded-lg bg-[var(--bg)] p-2 text-sm">
            <div>{t("elig_plan_summary", { m: plan.course_months, f: inr(plan.fees + plan.exam_fees), k: inr(plan.materials) })}</div>
            {exams.length > 0 && <div>{t("elig_plan_exams")}: {exams.join(", ")}</div>}
            <label className="mt-1 flex items-center gap-2">
              <input type="checkbox" checked={hostel === true} onChange={(e) => setHostel(e.target.checked)} />
              {t("elig_hostel")}
            </label>
          </div>
        )}
        {changes && (
          <div className="mt-2 text-sm" aria-live="polite">
            {changes.changed.length > 0 ? (
              /* one line until tapped: the full list is long and pushes the scholarships off screen */
              <details className="group rounded-lg bg-[var(--bg)] px-3 py-2">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold">
                  <span>🔄 {t("elig_changed_short", { n: changes.changed.length })}</span>
                  <span aria-hidden className="text-[var(--muted)] transition-transform group-open:rotate-90">›</span>
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {changes.changed.map((c: any) => (
                    <li key={c.id} className="leading-snug">
                      {c.name}
                      <span className="block text-xs text-[var(--muted)]">{t(c.before)} → <b className="text-[var(--ink)]">{t(c.after)}</b></span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="text-[var(--muted)]">{t("elig_same_as_now")}</p>
            )}
            {changes.for_this_course.length === 0 && <p className="mt-1 text-[var(--muted)]">{t("elig_no_course_scheme")}</p>}
          </div>
        )}
      </Card>
      <div ref={pg.top} />
      <Tabs cols={2} value={status} onChange={setPicked}
        tabs={STATUSES.map((s) => ({ key: s, label: `${STATUS_ICON[s]} ${t(`st_${s}`)}`, count: counts[s] || 0 }))} />
      {shown.length === 0 && <Card><p className="text-sm text-[var(--muted)]">{t("st_none")}</p></Card>}
      <div className="space-y-2">
        {pg.pageItems.map((e: any) => (
          <SchemeResult key={`${e.id}-${focus}-${planId}`} e={e} hideStatus onPage open={e.id === focus}
            tag={changedIds.has(e.id) ? t("elig_tag_changed") : forCourse.has(e.id) ? t("elig_tag_course") : undefined} />
        ))}
      </div>
      <Pager {...pg} shown={pg.pageItems.length} />
    </Shell>
  );
}
