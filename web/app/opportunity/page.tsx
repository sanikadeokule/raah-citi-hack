"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { Badge, Card, Shell, Source } from "@/components/ui";
import { inr, rankCareers } from "@/lib/engine";
import { pickForCareers, tradeMatches, type CareerChoice } from "@/lib/listings";
import { useApp } from "@/lib/store";
import { Mentors } from "@/components/mentors";
import { CareerFilter, RelatedNote } from "@/components/careerfilter";

export default function Opportunity() {
  const { data, profile, t } = useApp();
  const [q, setQ] = useState("");
  const top = useMemo(() => (data && profile ? rankCareers(data, profile, 5).map((s: any) => s.career.id) : []), [data, profile]);
  const [picked, setCareer] = useState<CareerChoice | null>(null);
  const career: CareerChoice = picked ?? (top.length ? "top" : "all");
  const match = (s: string) => String(s || "").toLowerCase().includes(q.toLowerCase());
  // the career dropdown picks the rows, the search box narrows them further
  const searched = (p: { items: any[]; related: any[] | null }, keep: (n: any) => boolean) => ({ ...p, items: p.items.filter(keep) });
  const naps = searched(pickForCareers(data, data?.naps || [], career, top, tradeMatches), (n) => match(n.trade) || match(n.employer) || match(n.location));
  const rail = searched(pickForCareers(data, data?.railway || [], career, top, tradeMatches), (n) => match(n.trade) || match(n.employer));
  return (
    <Shell title={t("opportunities")}>
      <CareerFilter value={career} onChange={setCareer} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Electrician, Fitter, Chakan…" className="w-full rounded-xl bg-[var(--card)] p-3 ring-1 ring-black/10" />
      <Mentors career={career} top={top} />
      <Card>
        <h2 className="mb-2 font-bold">🏭 NAPS apprenticeships · Pune <Badge>{naps.items.length}</Badge></h2>
        {!q && <RelatedNote picked={naps} />}
        <ul className="divide-y divide-black/5">
          {naps.items.map((n: any) => (
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
        <h2 className="mb-2 font-bold">🚆 Central Railway (Pune cluster) <Badge>{rail.items.length}</Badge></h2>
        {!q && <RelatedNote picked={rail} />}
        <ul className="divide-y divide-black/5">
          {rail.items.map((n: any) => (
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
