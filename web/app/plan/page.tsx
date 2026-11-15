"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Badge, Card, Shell, Source } from "@/components/ui";
import { CashChart, ParentNote, PaybackCard, SchemeResult, WhatIf } from "@/components/plan";
import { computePlan, inr, type PlanOptions } from "@/lib/engine";
import { useApp } from "@/lib/store";
import { coursesFor } from "@/lib/helpers";

function PlanView() {
  const id = useSearchParams().get("id") || "PLN01";
  const { data, profile, t } = useApp();
  const [opts, setOpts] = useState<PlanOptions>({});
  const plan = data?.plans.find((p: any) => p.id === id);
  const r = useMemo(() => (data && profile && plan ? computePlan(data, profile, id, opts) : null), [data, profile, id, opts, plan]);
  if (!plan) return <Card>Plan {id} is not in the Plan_Inputs sheet.</Card>;
  if (!r) return null;
  const courses = coursesFor(data, r.career, plan);
  const others = data.plans.filter((p: any) => p.id !== id);
  return (
    <>
      <Card>
        <div className="text-xs text-[var(--muted)]">{r.career.category}</div>
        <h2 className="text-xl font-bold">{plan.label}</h2>
        <div className="mt-1 text-sm text-[var(--muted)]">{plan.course_months} {t("months_training")}{plan.earn_months ? ` + ${plan.earn_months} ${t("earn_training")}` : ""}</div>
        <h3 className="mt-3 font-semibold">{t("steps")}</h3>
        <ol className="mt-1 space-y-1">
          {plan.steps.map((s: string, i: number) => (
            <li key={i} className="flex gap-2 text-sm"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-xs font-bold">{i + 1}</span>{s}</li>
          ))}
        </ol>
      </Card>

      <PaybackCard r={r} />
      <WhatIf r={r} opts={opts} setOpts={setOpts} />

      <Card>
        <h2 className="mb-1 text-lg font-bold">📈 {t("cumulative")}</h2>
        <CashChart results={[r]} />
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">🎓 {t("eligibility")}</h2>
        <div className="space-y-2">
          {r.eligibility.filter((e: any) => e.status !== "not_eligible").slice(0, 5).map((e: any, i: number) => <SchemeResult key={e.id} e={e} open={i === 0} />)}
        </div>
        <Link href="/eligibility/" className="mt-2 block text-sm text-[var(--brand-ink)] underline">All {data.scholarships.length} schemes →</Link>
      </Card>

      {r.centres.length > 0 && (
        <Card>
          <h2 className="mb-2 text-lg font-bold">📍 {t("nearest_centres")}</h2>
          <ul className="space-y-2">
            {r.centres.map((c: any) => (
              <li key={c.id} className="rounded-xl bg-[var(--bg)] p-3 text-sm">
                <div className="flex justify-between gap-2"><b>{c.name}</b><span className="whitespace-nowrap">{c.distance_km ?? "—"} km</span></div>
                <div className="text-xs text-[var(--muted)]">{c.address} · {c.type}{c.approximate && <> · <Badge tone="amber">{t("approx_distance")}</Badge></>}</div>
                <div className="text-xs text-[var(--muted)]">Fees: {c.fees_text}</div>
                <Source url={c.source} date={c.last_checked} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {courses.length > 0 && (
        <Card>
          <h2 className="mb-2 text-lg font-bold">📚 {t("courses")}</h2>
          <ul className="space-y-2 text-sm">
            {courses.map((c: any) => (
              <li key={c.id}><a className="font-medium underline" href={c.source} target="_blank" rel="noreferrer">{c.title}</a>
                <div className="text-xs text-[var(--muted)]">{c.platform} · {c.language} · {c.fee_text} · {c.duration}</div></li>
            ))}
          </ul>
        </Card>
      )}

      <ParentNote r={r} />

      <Card>
        <h2 className="mb-2 font-bold">⚖️ {t("compare")}</h2>
        <div className="flex flex-wrap gap-2">
          {others.map((p: any) => (
            <Link key={p.id} href={`/compare/?a=${id}&b=${p.id}`} className="rounded-full bg-[var(--bg)] px-3 py-1.5 text-sm ring-1 ring-black/10">vs {p.label}</Link>
          ))}
        </div>
      </Card>
      <p className="text-center text-xs text-[var(--muted)]">Net {inr(r.net_cost)} · all figures from {data.version.file}</p>
    </>
  );
}

export default function PlanPage() {
  const { t } = useApp();
  return (
    <Shell title={t("see_plan")} back="/careers/">
      <Suspense><PlanView /></Suspense>
    </Shell>
  );
}
