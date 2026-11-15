"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { Card, Shell } from "@/components/ui";
import { SchemeResult } from "@/components/plan";
import { eligibility } from "@/lib/engine";
import { useApp } from "@/lib/store";

export default function EligibilityPage() {
  const { data, profile, t } = useApp();
  const [planId, setPlanId] = useState<string>("");
  const [focus, setFocus] = useState<string | null>(null);
  // a teacher's recommendation links here with ?scheme=…&plan=…; show that scheme first and open
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("plan")) setPlanId(q.get("plan")!);
    setFocus(q.get("scheme"));
  }, []);
  const list = useMemo(() => {
    if (!data || !profile) return [];
    const plan = data.plans.find((p: any) => p.id === planId);
    const all = eligibility(data, profile, plan);
    return focus ? [...all.filter((e: any) => e.id === focus), ...all.filter((e: any) => e.id !== focus)] : all;
  }, [data, profile, planId, focus]);
  const counts = list.reduce((a: any, e: any) => ({ ...a, [e.status]: (a[e.status] || 0) + 1 }), {});
  return (
    <Shell title={t("eligibility")}>
      <Card>
        <label className="text-sm">{t("plan_for")}:
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="ml-2 rounded bg-[var(--bg)] p-1">
            <option value="">Now (Class {profile?.class})</option>
            {data?.plans.map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          {["eligible", "eligible_missing_docs", "need_info", "not_eligible"].map((s) => <span key={s}>{t(s)}: <b>{counts[s] || 0}</b></span>)}
        </div>
      </Card>
      <div className="space-y-2">
        {list.map((e: any, i: number) => <SchemeResult key={`${e.id}-${focus}`} e={e} open={i === 0} />)}
      </div>
    </Shell>
  );
}
