"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Card, Shell } from "@/components/ui";
import { Tabs } from "@/components/tabs";
import { CashChart, ParentNote, PaybackCard, SchemeResult, WhatIf } from "@/components/plan";
import { computePlan, inr, type PlanOptions } from "@/lib/engine";
import { useApp } from "@/lib/store";
import { coursesFor } from "@/lib/helpers";
import { PlanExams } from "@/components/exams";
import { CentresCard, CoursesCard } from "@/components/getstarted";

function PlanView() {
  const id = useSearchParams().get("id") || "PLN01";
  const { data, profile, t, lang } = useApp();
  const [opts, setOpts] = useState<PlanOptions>({});
  const [tab, setTab] = useState<"money" | "schemes" | "start" | "parent" | "compare">("money");
  const plan = data?.plans.find((p: any) => p.id === id);
  const r = useMemo(() => (data && profile && plan ? computePlan(data, profile, id, opts) : null), [data, profile, id, opts, plan]);
  if (!plan) return <Card>{t("plan_missing", { id })}</Card>;
  if (!r) return null;
  const courses = coursesFor(data, r.career, plan);
  const others = data.plans.filter((p: any) => p.id !== id);
  return (
    <>
      <Card className="lg:!p-3">
        <div className="lg:flex lg:items-start lg:justify-between lg:gap-6">
          <div>
            <div className="text-xs text-[var(--muted)]">{r.career.category}</div>
            <h2 className="text-xl font-bold">{plan.label}</h2>
            <div className="mt-1 text-sm text-[var(--muted)]">{plan.course_months} {t("months_training")}{plan.earn_months ? ` + ${plan.earn_months} ${t("earn_training")}` : ""}</div>
          </div>
          <div className="mt-2 lg:mt-0 lg:max-w-[60%]">
            <h3 className="font-semibold">{t("steps")}</h3>
            <ol className="mt-1 flex flex-col gap-1 lg:flex-row lg:flex-wrap lg:gap-x-4">
              {plan.steps.map((s: string, i: number) => (
                <li key={i} className="flex gap-2 text-sm"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-xs font-bold">{i + 1}</span>{s}</li>
              ))}
            </ol>
          </div>
        </div>
      </Card>

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: "money", label: t("total_cost") },
        { key: "schemes", label: t("eligibility") },
        { key: "start", label: t("rm_tab_start") },
        { key: "parent", label: t("parent_message") },
        { key: "compare", label: t("compare") },
      ]} />

      {tab === "money" && (
        <div className="space-y-4 lg:grid lg:grid-cols-3 lg:items-start lg:gap-4 lg:space-y-0">
          <PaybackCard r={r} />
          <WhatIf r={r} opts={opts} setOpts={setOpts} />
          <Card>
            <h2 className="mb-1 text-lg font-bold">{t("cumulative")}</h2>
            <CashChart results={[r]} />
          </Card>
        </div>
      )}

      {tab === "schemes" && (
        <Card>
          <h2 className="mb-2 text-lg font-bold">{t("eligibility")}</h2>
          <div className="space-y-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
            {r.eligibility.filter((e: any) => e.status !== "not_eligible").slice(0, 4).map((e: any, i: number) => <SchemeResult key={e.id} e={e} open={i === 0} />)}
          </div>
          <Link href="/eligibility/" className="mt-2 block text-sm text-[var(--brand-ink)] underline">{t("plan_all_schemes", { n: data.scholarships.length })} →</Link>
        </Card>
      )}

      {tab === "start" && (
        <div className="space-y-4 lg:grid lg:grid-cols-3 lg:items-start lg:gap-4 lg:space-y-0">
          <PlanExams plan={plan} />
          <CentresCard centres={r.centres.slice(0, 2)} />
          <CoursesCard courses={courses} />
        </div>
      )}

      {tab === "parent" && <ParentNote r={r} />}

      {tab === "compare" && (
        <Card>
          <h2 className="mb-2 font-bold">{t("compare")}</h2>
          <div className="flex flex-wrap gap-2">
            {others.map((p: any) => (
              <Link key={p.id} href={`/compare/?a=${id}&b=${p.id}`} className="rounded-full bg-[var(--bg)] px-3 py-1.5 text-sm ring-1 ring-black/10">{t("plan_vs", { name: p.label })}</Link>
            ))}
          </div>
        </Card>
      )}
      <p className="text-center text-xs text-[var(--muted)]">{t("plan_source_note", { amount: inr(r.net_cost), file: data.version.file })}</p>
    </>
  );
}

export default function PlanPage() {
  const { t } = useApp();
  return (
    <Shell title={t("see_plan")} back="/careers/" wide>
      <Suspense><PlanView /></Suspense>
    </Shell>
  );
}
