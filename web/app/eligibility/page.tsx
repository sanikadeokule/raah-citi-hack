"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { Card, Shell } from "@/components/ui";
import { SchemeResult } from "@/components/plan";
import { eligibility, eligibilityChanges, inr } from "@/lib/engine";
import { useApp } from "@/lib/store";

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
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          {["eligible", "eligible_missing_docs", "need_info", "not_eligible"].map((s) => <span key={s}>{t(s)}: <b>{counts[s] || 0}</b></span>)}
        </div>
        {changes && (
          <div className="mt-2 text-sm" aria-live="polite">
            {changes.changed.length > 0 ? (
              <>
                <b>{t("elig_changed", { n: changes.changed.length })}</b>
                <ul className="mt-1 space-y-0.5">
                  {changes.changed.map((c: any) => <li key={c.id}>• {c.name}: {t(c.before)} → <b>{t(c.after)}</b></li>)}
                </ul>
              </>
            ) : (
              <p className="text-[var(--muted)]">{t("elig_same_as_now")}</p>
            )}
            {changes.for_this_course.length === 0 && <p className="mt-1 text-[var(--muted)]">{t("elig_no_course_scheme")}</p>}
          </div>
        )}
      </Card>
      <div className="space-y-2">
        {list.map((e: any, i: number) => (
          <SchemeResult key={`${e.id}-${focus}-${planId}`} e={e} open={i === 0}
            tag={changedIds.has(e.id) ? t("elig_tag_changed") : forCourse.has(e.id) ? t("elig_tag_course") : undefined} />
        ))}
      </div>
    </Shell>
  );
}
