"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { Badge, Card, Shell, Source } from "@/components/ui";
import { inr, rankCareers } from "@/lib/engine";
import { pickForCareers, tradeMatches, type CareerChoice } from "@/lib/listings";
import { useApp } from "@/lib/store";
import { myCareer } from "@/lib/tailor";
import { Mentors } from "@/components/mentors";
import { CareerFilter, RelatedNote } from "@/components/careerfilter";
import { Pager, usePaged } from "@/components/pager";
import { Tabs } from "@/components/tabs";
import { MODULE_COLOR, Meter, ModuleHero } from "@/components/modulehero";

const PAGE = 10;

export default function Opportunity() {
  const { data, profile, t } = useApp();
  const [q, setQ] = useState("");
  const top = useMemo(() => (data && profile ? rankCareers(data, profile, 5).map((s: any) => s.career.id) : []), [data, profile]);
  const [picked, setCareer] = useState<CareerChoice | null>(null);
  // the rule from lib/tailor.ts: the saved career, else the best match; "All" stays in the dropdown
  const mc = myCareer(data, profile);
  const career: CareerChoice = picked ?? (mc ? mc.career.id : top.length ? "top" : "all");
  const match = (s: string) => String(s || "").toLowerCase().includes(q.toLowerCase());
  // the career dropdown picks the rows, the search box narrows them further
  const searched = (p: { items: any[]; related: any[] | null }, keep: (n: any) => boolean) => ({ ...p, items: p.items.filter(keep) });
  const naps = searched(pickForCareers(data, data?.naps || [], career, top, tradeMatches), (n) => match(n.trade) || match(n.employer) || match(n.location));
  const rail = searched(pickForCareers(data, data?.railway || [], career, top, tradeMatches), (n) => match(n.trade) || match(n.employer));
  const reset = `${career}|${q}`;
  const napsPg = usePaged(naps.items, PAGE, reset);
  const railPg = usePaged(rail.items, PAGE, reset);
  const [tab, setTab] = useState<"naps" | "rail" | "mentors">("naps");
  // the best stipend in view, so each row's bar shows how it compares
  const maxStipend = Math.max(0, ...naps.items.map((n: any) => n.stipend?.high || 0), ...rail.items.map((n: any) => n.stipend || 0));
  // the profile menu's "My Mentor" links here with ?tab=mentors
  useEffect(() => { if (new URLSearchParams(location.search).get("tab") === "mentors") setTab("mentors"); }, []);
  return (
    <Shell title={t("opportunities")} wide>
      <ModuleHero color={MODULE_COLOR.jobs} item="bag"
        line={t("hero_jobs", { n: naps.items.length + rail.items.length })}
        stats={[
          { icon: "wrench", value: naps.items.length, label: t("hero_stat_naps") },
          { icon: "train", value: rail.items.length, label: t("hero_stat_rail") },
          ...(maxStipend ? [{ icon: "rupee", value: inr(maxStipend), label: t("hero_stat_stipend") }] : []),
        ]} />
      <CareerFilter value={career} onChange={setCareer} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Electrician, Fitter, Chakan…" className="w-full rounded-xl bg-[var(--card)] p-3 ring-1 ring-black/10" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: "naps", label: `${t("opp_tab_naps")}`, count: naps.items.length },
        { key: "rail", label: `${t("opp_tab_rail")}`, count: rail.items.length },
        { key: "mentors", label: `${t("opp_tab_mentors")}` },
      ]} />
      {tab === "mentors" && <Mentors career={career} top={top} />}
      {tab === "naps" && <Card>
        <div ref={napsPg.top} />
        <h2 className="mb-2 font-bold">NAPS apprenticeships · Pune <Badge>{naps.items.length}</Badge></h2>
        {!q && <RelatedNote picked={naps} />}
        <ul className="divide-y divide-black/5 lg:grid lg:grid-cols-2 lg:gap-x-8 lg:divide-y-0">
          {napsPg.pageItems.map((n: any) => (
            <li key={n.id} className="py-2 text-sm lg:border-b lg:border-black/5">
              <div className="flex justify-between gap-2"><b>{n.trade}</b><span className="whitespace-nowrap">{n.stipend ? `${inr(n.stipend.low)}–${inr(n.stipend.high)}` : n.stipend_text}</span></div>
              {n.stipend?.high ? <Meter value={n.stipend.high} max={maxStipend} color={MODULE_COLOR.jobs} /> : null}
              <div className="text-xs text-[var(--muted)]">{n.employer} · {n.location} · {n.duration}</div>
              <div className="flex items-center justify-between"><Source url={n.source} label="apprenticeshipindia.gov.in" date={`posted ${n.posted}`} />
                <a href={n.source} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[var(--brand-ink)] underline">Apply</a></div>
            </li>
          ))}
        </ul>
        <Pager {...napsPg} shown={napsPg.pageItems.length} />
      </Card>}
      {tab === "rail" && <Card>
        <div ref={railPg.top} />
        <h2 className="mb-2 font-bold">Central Railway (Pune cluster) <Badge>{rail.items.length}</Badge></h2>
        {!q && <RelatedNote picked={rail} />}
        <ul className="divide-y divide-black/5 lg:grid lg:grid-cols-2 lg:gap-x-8 lg:divide-y-0">
          {railPg.pageItems.map((n: any) => (
            <li key={n.id} className="py-2 text-sm lg:border-b lg:border-black/5">
              <div className="flex justify-between gap-2"><b>{n.trade}</b><span>{n.seats} seats · {inr(n.stipend)}{t("per_month")}</span></div>
              {n.stipend ? <Meter value={n.stipend} max={maxStipend} color={MODULE_COLOR.jobs} /> : null}
              <div className="text-xs text-[var(--muted)]">{n.employer} · {n.notice}</div>
              <Source url={n.source} label="rrccr.com" date={n.last_checked} />
            </li>
          ))}
        </ul>
        <Pager {...railPg} shown={railPg.pageItems.length} />
      </Card>}
    </Shell>
  );
}
