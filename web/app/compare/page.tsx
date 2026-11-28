"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Badge, Card, Shell } from "@/components/ui";
import { CashChart, incomeSub, paybackText } from "@/components/plan";
import { computePlan, inr, type PlanOptions } from "@/lib/engine";
import { useApp } from "@/lib/store";

function CompareView() {
  const sp = useSearchParams();
  const router = useRouter();
  const { data, profile, t, setProfile, queueAction, auth } = useApp();
  const [saved, setSaved] = useState("");
  const a = sp.get("a") || data.plans[0]?.id;
  const b = sp.get("b") || data.plans[1]?.id;
  const [opts, setOpts] = useState<PlanOptions>({});
  const rs = useMemo(() => (profile ? [a, b].filter((x) => data.plans.some((p: any) => p.id === x)).map((id) => computePlan(data, profile, id, opts)) : []), [data, profile, a, b, opts]);
  if (rs.length < 2) return <Card>{t("compare_need_two_plans")}</Card>;
  const rows: [string, (r: any) => React.ReactNode][] = [
    [t("months_training"), (r) => `${r.plan.course_months}${r.plan.earn_months ? ` + ${r.plan.earn_months}` : ""}`],
    [t("total_cost"), (r) => inr(r.costs.total)],
    [t("scholarship_cover"), (r) => (r.scholarship.low ? `− ${inr(r.scholarship.low)}` : "—")],
    [t("stipend_during_training"), (r) => (r.stipend.total ? `− ${inr(r.stipend.total)}` : "—")],
    [t("net_cost"), (r) => <b>{inr(Math.max(0, r.net_cost))}</b>],
    [t("monthly_income"), (r) => (r.income ? <>{inr(r.income.median)} <span className="text-xs text-[var(--muted)]">({incomeSub(t, r.income)})</span>{r.income.estimate && <> <Badge tone="amber">{t("estimate")}</Badge></>}</> : "—")],
    [t("payback"), (r) => <b>{paybackText(t, r.payback.median, data)}</b>],
    [`${t("payback")} (${t("low")})`, (r) => paybackText(t, r.payback.low, data)],
  ];
  // Raah's suggestion is a plain rule: lower cost after scholarships, and when the costs are within 5% the shorter path.
  const [x, y] = rs;
  const netX = Math.max(0, x.net_cost), netY = Math.max(0, y.net_cost);
  const close = Math.abs(netX - netY) <= 0.05 * Math.max(netX, netY, 1);
  const best = close ? (x.plan.course_months <= y.plan.course_months ? x : y) : (netX <= netY ? x : y);
  const why = close ? t("cmp_why_time", { a: best.plan.label }) : t("cmp_why_cost", { a: best.plan.label });
  function choose(r: any) {
    const next = { ...profile, roadmap_career: r.plan.career_id, roadmap_at: new Date().toISOString() };
    setProfile(next); queueAction("profile", next); setSaved(t("cmp_picked", { a: r.plan.label }));
  }
  const pick = (which: "a" | "b", v: string) => router.replace(`/compare/?a=${which === "a" ? v : a}&b=${which === "b" ? v : b}`);
  const maxCost = Math.max(netX, netY, 1);
  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] xl:items-start xl:gap-4">
      <Card className="space-y-1 xl:col-span-3 xl:!p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("cmp_suggests")}</div>
        <p className="text-sm font-semibold">{why}</p>
        <p className="text-xs text-[var(--muted)]">{t("cmp_choice")}</p>
        {!auth && <p className="text-xs text-[var(--muted)]">{t("cmp_signin")}</p>}
        {saved && <p role="status" className="text-sm text-[var(--good)]">{saved}</p>}
      </Card>
      {(["a", "b"] as const).map((w, i) => {
        const r = rs[i];
        const isBest = r === best;
        const net = Math.max(0, r.net_cost);
        return (
          <Card key={w} className={`mt-3 xl:mt-4 space-y-2 ${isBest ? "ring-2 ring-[var(--brand)]" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <select value={r.plan.id} onChange={(e) => pick(w, e.target.value)}
                className={`min-w-0 flex-1 rounded-xl p-2 text-sm font-semibold text-white ${i === 0 ? "bg-[var(--brand)]" : "bg-[var(--accent)]"}`}>
                {data.plans.map((p: any) => <option key={p.id} value={p.id} className="text-black">{p.label}</option>)}
              </select>
              {isBest && <Badge tone="green">{t("cmp_suggests")}</Badge>}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--bg)]">
              <div className={`h-full rounded-full ${isBest ? "bg-[var(--brand)]" : "bg-[var(--muted)]"}`} style={{ width: `${Math.max(4, (net / maxCost) * 100)}%` }} />
            </div>
            <table className="w-full text-sm">
              <tbody>
                {rows.map(([label, f]) => (
                  <tr key={label} className="border-b border-black/5 align-top">
                    <td className="py-2 pr-2 text-xs text-[var(--muted)]">{label}</td>
                    <td className="py-2 pr-1 tabular-nums">{f(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={() => choose(r)} disabled={!auth}
              className={`w-full rounded-xl px-2 py-2.5 text-sm font-semibold disabled:opacity-50 ${isBest ? "bg-[var(--brand)] text-white" : "bg-[var(--bg)] ring-1 ring-black/10"}`}>
              {t("cmp_pick")}<span className="block text-xs font-normal opacity-80">{r.plan.label}</span></button>
          </Card>
        );
      })}
      <div className="mt-3 space-y-3 xl:mt-4">
      <Card>
        <h2 className="mb-1 font-bold">{t("cumulative")}</h2>
        <CashChart results={rs} height={190} />
      </Card>
      <Card>
        <h2 className="mb-2 font-bold">{t("what_if")}</h2>
        <div className="space-y-1">
          <label className="flex items-center justify-between rounded-lg px-1 py-1 xl:bg-[var(--bg)] xl:px-3 xl:py-2"><span>{t("scholarship_toggle")}</span>
            <input type="checkbox" className="h-6 w-6" checked={opts.scholarships === undefined || opts.scholarships === null}
              onChange={(e) => setOpts({ ...opts, scholarships: e.target.checked ? null : [] })} /></label>
          <label className="flex items-center justify-between rounded-lg px-1 py-1 xl:bg-[var(--bg)] xl:px-3 xl:py-2"><span>{t("stay_in_hostel")}</span>
            <input type="checkbox" className="h-6 w-6" checked={!!opts.hostel} onChange={(e) => setOpts({ ...opts, hostel: e.target.checked })} /></label>
          <label className="block rounded-lg px-1 py-1 xl:bg-[var(--bg)] xl:px-3 xl:py-2"><div className="flex justify-between"><span>{t("commute_km")}</span><b>{opts.commute_km ?? t("compare_auto")}</b></div>
            <input type="range" min={0} max={60} className="w-full" value={opts.commute_km ?? 0} onChange={(e) => setOpts({ ...opts, commute_km: Number(e.target.value) })} /></label>
        </div>
      </Card>
      </div>
    </div>
  );
}

export default function ComparePage() {
  const { t } = useApp();
  return <Shell title={t("compare_two")} wide><Suspense><CompareView /></Suspense></Shell>;
}
