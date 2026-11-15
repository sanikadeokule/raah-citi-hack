"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Card, Shell } from "@/components/ui";
import { computePlan, inr, rankCareers } from "@/lib/engine";
import { useApp } from "@/lib/store";
import { paybackText } from "@/components/plan";

function flagBadges(c: any) {
  return (
    <span className="flex flex-wrap gap-1">
      {c.flags.vocational && <Badge tone="blue">Vocational</Badge>}
      {c.flags.self_employment && <Badge tone="amber">Self-employment</Badge>}
      {c.flags.health && <Badge tone="green">Health</Badge>}
      {c.flags.non_stem && !c.flags.self_employment && <Badge>Non-STEM</Badge>}
    </span>
  );
}

export default function CareersPage() {
  const { data, profile, t } = useApp();
  const [q, setQ] = useState("");
  const top = useMemo(() => (data && profile ? rankCareers(data, profile, 5) : []), [data, profile]);
  const plans = useMemo(() => Object.fromEntries((data?.plans || []).map((p: any) => [p.career_id, p])), [data]);
  const quick = (planId: string) => computePlan(data, profile, planId);
  const all = (data?.careers || []).filter((c: any) => c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Shell title={t("home_careers")}>
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">⭐ {t("shortlist")}</h2>
          <Link href="/profile/" className="text-sm underline">{t("edit_profile")}</Link>
        </div>
        <p className="text-xs text-[var(--muted)]">{(profile?.interests || []).join(", ")}</p>
        <ul className="mt-2 space-y-2">
          {top.map((s: any, i: number) => {
            const r = s.plan_id ? quick(s.plan_id) : null;
            return (
              <li key={s.career.id} className="rounded-xl bg-[var(--bg)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div><span className="mr-1 text-[var(--muted)]">{i + 1}.</span><b>{s.career.name}</b></div>
                  <span className="text-xs text-[var(--muted)]">{Math.round(s.score * 100)}%</span>
                </div>
                <div className="mt-1">{flagBadges(s.career)}</div>
                <p className="mt-1 text-sm">{s.why}</p>
                {r ? (
                  <Link href={`/plan/?id=${s.plan_id}`} className="mt-2 flex items-center justify-between rounded-lg bg-[var(--brand)] px-3 py-2 text-sm text-white">
                    <span>{t("net_cost")}: <b>{inr(Math.max(0, r.net_cost))}</b> · {paybackText(t, r.payback.median, data)}</span><span>›</span>
                  </Link>
                ) : (
                  <p className="mt-1 text-xs text-[var(--muted)]">{t("no_plan_yet")} · {s.career.income_text}</p>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      <Card>
        <h2 className="text-lg font-bold">{t("all_careers")}</h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="mt-2 w-full rounded-lg bg-[var(--bg)] p-2" />
        <ul className="mt-2 divide-y divide-black/5">
          {all.map((c: any) => (
            <li key={c.id} className="py-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-[var(--muted)]">{c.entry_path}</div>
                  <div className="text-xs text-[var(--muted)]">{c.income_text}</div>
                </div>
                {plans[c.id] && <Link href={`/plan/?id=${plans[c.id].id}`} className="shrink-0 rounded-full bg-[var(--brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--brand-ink)]">₹ plan</Link>}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </Shell>
  );
}
