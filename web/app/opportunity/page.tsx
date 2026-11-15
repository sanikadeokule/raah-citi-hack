"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { Badge, Card, Shell, Source } from "@/components/ui";
import { inr } from "@/lib/engine";
import { useApp } from "@/lib/store";

export default function Opportunity() {
  const { data, t } = useApp();
  const [q, setQ] = useState("");
  const match = (s: string) => String(s || "").toLowerCase().includes(q.toLowerCase());
  const naps = (data?.naps || []).filter((n: any) => match(n.trade) || match(n.employer) || match(n.location));
  const rail = (data?.railway || []).filter((n: any) => match(n.trade) || match(n.employer));
  return (
    <Shell title={t("opportunities")}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Electrician, Fitter, Chakan…" className="w-full rounded-xl bg-[var(--card)] p-3 ring-1 ring-black/10" />
      <Card>
        <h2 className="mb-2 font-bold">🏭 NAPS apprenticeships · Pune <Badge>{naps.length}</Badge></h2>
        <ul className="divide-y divide-black/5">
          {naps.map((n: any) => (
            <li key={n.id} className="py-2 text-sm">
              <div className="flex justify-between gap-2"><b>{n.trade}</b><span className="whitespace-nowrap">{n.stipend ? `${inr(n.stipend.low)}–${inr(n.stipend.high)}` : n.stipend_text}</span></div>
              <div className="text-xs text-[var(--muted)]">{n.employer} · {n.location} · {n.duration}</div>
              <div className="flex items-center justify-between"><Source url={n.source} label="apprenticeshipindia.gov.in" date={`posted ${n.posted}`} />
                <a href={n.source} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[var(--brand-ink)] underline">Apply</a></div>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="mb-2 font-bold">🚆 Central Railway (Pune cluster) <Badge>{rail.length}</Badge></h2>
        <ul className="divide-y divide-black/5">
          {rail.map((n: any) => (
            <li key={n.id} className="py-2 text-sm">
              <div className="flex justify-between gap-2"><b>{n.trade}</b><span>{n.seats} seats · {inr(n.stipend)}{t("per_month")}</span></div>
              <div className="text-xs text-[var(--muted)]">{n.employer} · {n.notice}</div>
              <Source url={n.source} label="rrccr.com" date={n.last_checked} />
            </li>
          ))}
        </ul>
      </Card>
    </Shell>
  );
}
