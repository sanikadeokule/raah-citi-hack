"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Icon } from "@/components/icon";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, Shell } from "@/components/ui";
import { computePlan, inr, rankCareers } from "@/lib/engine";
import { useApp } from "@/lib/store";
import { tagLabel } from "@/lib/questions";
import { paybackText } from "@/components/plan";
import { aiAvailable, postAi } from "@/lib/ai";
import { Pager, usePaged } from "@/components/pager";
import { MODULE_COLOR, ModuleHero, Ring } from "@/components/modulehero";

// National Career Service, Ministry of Labour & Employment, Government of India
const NCS_URL = "https://www.ncs.gov.in/";

/** Match reason: the template sentence first, replaced by the model's wording only if the server accepts it as grounded. */
function WhyLine({ s, profile, lang }: { s: any; profile: any; lang: string }) {
  const [ai, setAi] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setAi(null);
    aiAvailable().then(async (ok) => {
      if (!ok) return;
      const j = await postAi("/api/chat/explain", { profile, career_id: s.career.id, lang });
      if (live && j && !j.fallback && j.text) setAi(j.text);
    });
    return () => { live = false; };
  }, [s.career.id, profile, lang]);
  return <p className="mt-1 text-sm">{ai ? <> {ai}</> : s.why}</p>;
}

function flagBadges(c: any, t: (k: string) => string) {
  return (
    <span className="flex flex-wrap gap-1">
      {c.flags.vocational && <Badge tone="blue">{t("tag_vocational")}</Badge>}
      {c.flags.self_employment && <Badge tone="amber">{t("tag_self_employment")}</Badge>}
      {c.flags.health && <Badge tone="green">{t("tag_health")}</Badge>}
      {c.flags.non_stem && !c.flags.self_employment && <Badge>{t("tag_non_stem")}</Badge>}
    </span>
  );
}

export default function CareersPage() {
  const { data, profile, t, lang } = useApp();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"top" | "all">("top");
  const router = useRouter();
  // the whole career card opens its roadmap; links inside it (₹ plan) keep their own target
  const openRoadmap = (id: string) => router.push(`/roadmap/?career=${id}`);
  const cardProps = (id: string) => ({
    role: "link", tabIndex: 0,
    onClick: (e: React.MouseEvent) => { if (!(e.target as HTMLElement).closest("a")) openRoadmap(id); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter") openRoadmap(id); },
  });
  const top = useMemo(() => (data && profile ? rankCareers(data, profile, 5) : []), [data, profile]);
  const plans = useMemo(() => Object.fromEntries((data?.plans || []).map((p: any) => [p.career_id, p])), [data]);
  const quick = (planId: string) => computePlan(data, profile, planId);
  const all = (data?.careers || []).filter((c: any) => c.name.toLowerCase().includes(q.toLowerCase()));
  const pg = usePaged(all, 5, `${q}|${tab}`);
  const tabBtn = (id: "top" | "all", label: string) => (
    <button key={id} onClick={() => setTab(id)} aria-pressed={tab === id}
      className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold ${tab === id ? "bg-[var(--brand)] text-white" : "bg-[var(--bg)] ring-1 ring-black/10"}`}>{label}</button>
  );
  return (
    <Shell title={t("home_careers")} wide>
      <ModuleHero color={MODULE_COLOR.careers} item="compass"
        line={top.length ? t("hero_careers", { n: top.length }) : t("hero_careers_none")}
        stats={[
          ...(top[0] ? [{ icon: "star", value: `${Math.round(top[0].score * 100)}%`, label: t("hero_stat_best") }] : []),
          { icon: "compass", value: data?.careers?.length ?? 0, label: t("hero_stat_all") },
        ]} />
      <div className="flex gap-2">
        {tabBtn("top", `${t("shortlist")}`)}
        {tabBtn("all", t("all_careers", { n: data?.careers?.length ?? 0 }))}
      </div>
      {tab === "top" && <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{t("shortlist")}</h2>
          <Link href="/profile/" className="text-sm underline">{t("edit_profile")}</Link>
        </div>
        <p className="text-xs text-[var(--muted)]">{(profile?.interests || []).map((x: string) => tagLabel(t, x)).join(", ")}</p>
        <p className="mt-1 text-xs font-medium text-[var(--brand-ink)]">{t("rm_tap_hint")}</p>
        <ul className="mt-2 space-y-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
          {top.map((s: any, i: number) => {
            const r = s.plan_id ? quick(s.plan_id) : null;
            return (
              <li key={s.career.id} {...cardProps(s.career.id)}
                className="cursor-pointer rounded-xl bg-[var(--bg)] p-3 ring-1 ring-transparent transition hover:ring-[var(--brand)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] active:scale-[0.99]">
                <div className="flex items-start justify-between gap-2">
                  <div><span className="mr-1 text-[var(--muted)]">{i + 1}.</span><b>{s.career.name}</b></div>
                  <Ring value={s.score} color={MODULE_COLOR.careers} size={38} />
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {flagBadges(s.career, t)}
                  {/* say plainly when a career is only near the student's interests, or not linked to them at all */}
                  {s.has_interests && s.fit === "related" && <Badge tone="green">{t("fit_related")}</Badge>}
                  {s.has_interests && s.fit === "none" && <Badge>{t("fit_none")}</Badge>}
                </div>
                <WhyLine s={s} profile={profile} lang={lang} />
                {r ? (
                  <Link href={`/plan/?id=${s.plan_id}`} className="mt-2 flex items-center justify-between rounded-lg bg-[var(--brand)] px-3 py-2 text-sm text-white">
                    <span>{t("net_cost")}: <b>{inr(Math.max(0, r.net_cost))}</b> · {paybackText(t, r.payback.median, data)}</span><span>›</span>
                  </Link>
                ) : (
                  <p className="mt-1 text-xs text-[var(--muted)]">{s.career.income_text}</p>
                )}
                <div className="mt-2 flex items-center justify-between rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-sm font-semibold text-[var(--brand-ink)]">
                  <span>{t("rm_see")}</span><span>›</span>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>}
      {/* the Government of India's own career portal, for careers beyond this list */}
      <a href={NCS_URL} target="_blank" rel="noreferrer"
        className="flex items-center gap-3 rounded-xl bg-[var(--card)] p-3 text-sm ring-1 ring-black/5 active:scale-[.98]">
        <Icon name="building" size={24} className="text-[var(--brand)]" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{t("careers_gov_title")}</span>
          <span className="block text-xs text-[var(--muted)]">{t("careers_gov_sub")}</span>
          <span className="block truncate text-xs font-semibold text-[var(--brand-ink)] underline">ncs.gov.in</span>
        </span>
        <span aria-hidden className="text-lg text-[var(--muted)]"></span>
      </a>
      {tab === "all" && <Card>
        <h2 className="text-lg font-bold">{t("all_careers", { n: all.length })}</h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="mt-2 w-full rounded-lg bg-[var(--bg)] p-2" />
        <div ref={pg.top} />
        <ul className="mt-2 divide-y divide-black/5 lg:grid lg:grid-cols-2 lg:gap-x-6 lg:divide-y-0">
          {pg.pageItems.map((c: any) => (
            <li key={c.id} {...cardProps(c.id)} className="cursor-pointer py-2 hover:bg-[var(--bg)] lg:border-b lg:border-black/5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-[var(--muted)]">{c.entry_path}</div>
                  <div className="text-xs text-[var(--muted)]">{c.income_estimate && <Badge tone="amber">{t("estimate")}</Badge>} {c.income_text}</div>
                </div>
                <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="rounded-full bg-[var(--brand)] px-3 py-1 text-xs font-semibold text-white"><Icon name="map" size={14} className="align-[-2px]" /></span>
                {plans[c.id] && <Link href={`/plan/?id=${plans[c.id].id}`} className="shrink-0 rounded-full bg-[var(--brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--brand-ink)]">₹ plan</Link>}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <Pager {...pg} shown={pg.pageItems.length} />
      </Card>}
    </Shell>
  );
}
