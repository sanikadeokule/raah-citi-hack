"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Card, Shell } from "@/components/ui";
import { CashChart, paybackText } from "@/components/plan";
import { computePlan, inr, type PlanOptions } from "@/lib/engine";
import { useApp } from "@/lib/store";

function CompareView() {
  const sp = useSearchParams();
  const router = useRouter();
  const { data, profile, t } = useApp();
  const a = sp.get("a") || data.plans[0]?.id;
  const b = sp.get("b") || data.plans[1]?.id;
  const [opts, setOpts] = useState<PlanOptions>({});
  const rs = useMemo(() => (profile ? [a, b].filter((x) => data.plans.some((p: any) => p.id === x)).map((id) => computePlan(data, profile, id, opts)) : []), [data, profile, a, b, opts]);
  if (rs.length < 2) return <Card>Add at least two rows in Plan_Inputs.</Card>;
  const rows: [string, (r: any) => React.ReactNode][] = [
    [t("months_training"), (r) => `${r.plan.course_months}${r.plan.earn_months ? ` + ${r.plan.earn_months}` : ""}`],
    [t("total_cost"), (r) => inr(r.costs.total)],
    [t("scholarship_cover"), (r) => (r.scholarship.low ? `− ${inr(r.scholarship.low)}` : "—")],
    [t("stipend_during_training"), (r) => (r.stipend.total ? `− ${inr(r.stipend.total)}` : "—")],
    [t("net_cost"), (r) => <b>{inr(Math.max(0, r.net_cost))}</b>],
    [t("monthly_income"), (r) => (r.income ? `${inr(r.income.low)}–${inr(r.income.high)}` : "—")],
    [t("payback"), (r) => <b>{paybackText(t, r.payback.median, data)}</b>],
    [`${t("payback")} (${t("low")})`, (r) => paybackText(t, r.payback.low, data)],
  ];
  const pick = (which: "a" | "b", v: string) => router.replace(`/compare/?a=${which === "a" ? v : a}&b=${which === "b" ? v : b}`);
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {(["a", "b"] as const).map((w, i) => (
          <select key={w} value={rs[i].plan.id} onChange={(e) => pick(w, e.target.value)}
            className={`rounded-xl p-2 text-sm font-semibold text-white ${i === 0 ? "bg-[#0f6b5c]" : "bg-[#e07a1f]"}`}>
            {data.plans.map((p: any) => <option key={p.id} value={p.id} className="text-black">{p.label}</option>)}
          </select>
        ))}
      </div>
      <Card>
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([label, f]) => (
              <tr key={label} className="border-b border-black/5 align-top">
                <td className="py-2 pr-2 text-xs text-[var(--muted)]">{label}</td>
                {rs.map((r) => <td key={r.plan.id} className="py-2 pr-1 tabular-nums">{f(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <h2 className="mb-1 font-bold">📈 {t("cumulative")}</h2>
        <CashChart results={rs} height={280} />
      </Card>
      <Card>
        <h2 className="mb-2 font-bold">🔀 {t("what_if")}</h2>
        <label className="flex items-center justify-between py-1"><span>{t("scholarship_toggle")}</span>
          <input type="checkbox" className="h-6 w-6" checked={opts.scholarships === undefined || opts.scholarships === null}
            onChange={(e) => setOpts({ ...opts, scholarships: e.target.checked ? null : [] })} /></label>
        <label className="flex items-center justify-between py-1"><span>{t("stay_in_hostel")}</span>
          <input type="checkbox" className="h-6 w-6" checked={!!opts.hostel} onChange={(e) => setOpts({ ...opts, hostel: e.target.checked })} /></label>
        <label className="block py-1"><div className="flex justify-between"><span>{t("commute_km")}</span><b>{opts.commute_km ?? "auto"}</b></div>
          <input type="range" min={0} max={60} className="w-full" value={opts.commute_km ?? 0} onChange={(e) => setOpts({ ...opts, commute_km: Number(e.target.value) })} /></label>
      </Card>
    </>
  );
}

export default function ComparePage() {
  const { t } = useApp();
  return <Shell title={t("compare_two")}><Suspense><CompareView /></Suspense></Shell>;
}
