"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Icon } from "@/components/icon";
import { Mascot } from "@/components/mascot";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Card, Shell, Source } from "@/components/ui";
import { buildRoadmap, computePlan, inr, nearestCentres, rankCareers } from "@/lib/engine";
import { coursesFor } from "@/lib/helpers";
import { ParentNote, RoadmapParentNote } from "@/components/plan";
import { CentresCard, CoursesCard } from "@/components/getstarted";
import { useApp } from "@/lib/store";

// One colour and icon per kind of stage, so the road reads at a glance.
const KIND: Record<string, { icon: string; color: string }> = {
  school: { icon: "school", color: "#2563eb" },
  exam: { icon: "clipboard", color: "#1e40af" },
  course: { icon: "graduation", color: "#f28c28" },
  earn: { icon: "wrench", color: "#0f766e" },
  job: { icon: "briefcase", color: "#138808" },
};
const CLASSES = [9, 10, 11, 12, 13];

const range = (lo: number, hi: number) => (lo === hi ? inr(lo) : `${inr(lo)} – ${inr(hi)}`);

function stageName(s: any, lang: string) {
  return (lang === "hi" && s.name_hi) || (lang === "mr" && s.name_mr) || s.name;
}

function duration(t: any, months: number) {
  if (months <= 0) return "";
  if (months % 12 === 0) return months === 12 ? t("rm_one_year") : t("rm_years", { n: months / 12 });
  return t("rm_months", { n: months });
}

function RoadmapView() {
  const { data, profile, setProfile, t, lang, queueAction } = useApp();
  const qs = useSearchParams();
  const top = useMemo(() => (data && profile ? rankCareers(data, profile, 5) : []), [data, profile]);
  const careerId = qs.get("career") || profile?.roadmap_career || top[0]?.career.id;
  const profileClass = Math.min(13, Math.max(9, Math.trunc(Number(profile?.class) || 10)));
  const [cls, setCls] = useState<number | null>(null);
  const [tab, setTab] = useState<"road" | "other" | "start">("road");
  // Maina cheers for a moment when the student makes this road theirs
  const [cheer, setCheer] = useState(false);
  const cheerTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(cheerTimer.current), []);
  const startClass = cls ?? profileClass;
  const r = useMemo(() => (data && profile && careerId ? buildRoadmap(data, profile, careerId, startClass) : null),
    [data, profile, careerId, startClass]);
  const plan = r?.plan_id ? data?.plans.find((p: any) => p.id === r.plan_id) : null;
  const planResult = useMemo(() => (data && profile && plan ? computePlan(data, profile, plan.id) : null), [data, profile, plan]);
  if (!careerId || !r) return <Card>{t("rm_not_added")}</Card>;
  const year0 = new Date().getFullYear();
  const isMine = profile?.roadmap_career === careerId;
  // the page also previews a career before one is saved; only saving it unlocks the rest of the app
  const saved = Boolean(profile?.roadmap_at);
  const makeMine = () => {
    // also sent to the server, so alerts (official notices for this roadmap's exams) reach the student
    const next = { ...profile, roadmap_career: careerId, roadmap_at: new Date().toISOString() };
    setProfile(next);
    queueAction("profile", next);
    setCheer(true);
    window.clearTimeout(cheerTimer.current);
    cheerTimer.current = window.setTimeout(() => setCheer(false), 3200);
  };
  const tot = r.totals;
  const classLabel = (c: number) => (c >= 13 ? t("rm_12_pass") : t("rm_class_n", { n: c }));
  const journey = r.stages.filter((s: any) => s.months > 0);
  const others = top.filter((s: any) => s.career.id !== careerId);

  return (
    <>
      {/* hero: where you are, where this road ends */}
      <section className="overflow-hidden rounded-2xl bg-[var(--brand)] p-4 text-white shadow">
        <div className="text-xs uppercase tracking-wide opacity-80">{t("rm_title")}</div>
        <h2 className="mt-1 text-xl font-bold leading-snug">{r.career.name}</h2>
        <p className="mt-1 text-sm opacity-90">
          {t("rm_summary", { from: classLabel(startClass), y: duration(t, tot.months_to_job) || t("rm_now") })}
        </p>
        <div className="mt-3 text-xs opacity-80">{t("rm_i_am_in")}</div>
        <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label={t("rm_i_am_in")}>
          {CLASSES.map((c) => (
            <button key={c} onClick={() => setCls(c)} aria-pressed={startClass === c}
              className={`rounded-full px-3 py-1 text-sm font-semibold ${startClass === c ? "bg-white text-[var(--brand)]" : "bg-white/15"}`}>
              {classLabel(c)}
            </button>
          ))}
        </div>
      </section>

      {!saved && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <h3 className="font-bold">{t("rm_suggested_title")}</h3>
          <p className="mt-1 text-sm">{t("rm_suggested_text")}</p>
          <button onClick={makeMine} className="mt-3 w-full rounded-xl bg-[var(--brand)] py-3 font-semibold text-white">{t("rm_make_mine")}</button>
        </section>
      )}

      {/* this road, or the other careers that fit: side by side as tabs */}
      {(
        <div role="tablist" className={`grid gap-1 rounded-xl bg-[var(--card)] p-1 ring-1 ring-black/5 ${others.length > 0 ? "grid-cols-3" : "grid-cols-2"}`}>
          {([["road", `${t("rm_tab_this")}`], ["start", `${t("rm_tab_start")}`], ...(others.length > 0 ? [["other", `${t("rm_other_roads")} (${others.length})`]] : [])] as [typeof tab, string][]).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded-lg px-1 py-2 text-sm font-semibold leading-tight ${tab === k ? "bg-[var(--brand)] text-white" : "text-[var(--muted)]"}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === "start" ? (
        <>
          <CentresCard centres={planResult ? planResult.centres : nearestCentres(data, profile, null, 3)} />
          <CoursesCard courses={coursesFor(data, r.career, plan)} />
          {planResult ? <ParentNote r={planResult} /> : r.available && <RoadmapParentNote r={r} />}
          {plan && <Link href={`/plan/?id=${plan.id}`} className="block text-center text-sm font-semibold text-[var(--brand-ink)] underline">{t("rm_full_plan")} ›</Link>}
        </>
      ) : tab === "other" && others.length > 0 ? (
        <ul className="space-y-2">
          {others.map((s: any) => {
            const mine = profile?.roadmap_career === s.career.id;
            return (
              <li key={s.career.id}>
                <Link href={`/roadmap/?career=${s.career.id}`} onClick={() => { setTab("road"); setCls(null); window.scrollTo(0, 0); }}
                  className="block rounded-2xl bg-[var(--card)] p-3 shadow-sm ring-1 ring-black/5 active:scale-[.98]">
                  <span className="flex items-start justify-between gap-2">
                    <b className="leading-snug">{s.career.name}</b>
                    <span className="shrink-0 text-xs text-[var(--muted)]">{Math.round(s.score * 100)}%</span>
                  </span>
                  {mine && <span className="mt-1 inline-block"><Badge tone="green"> {t("rm_saved")}</Badge></span>}
                  {s.why && <span className="mt-1 block text-sm">{s.why}</span>}
                  <span className="mt-2 flex items-center justify-between rounded-lg bg-[var(--bg)] px-3 py-2 text-sm font-semibold text-[var(--brand-ink)]">
                     {t("rm_see_this_road")} <span aria-hidden>›</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : !r.available ? <Card>{t("rm_not_added")}</Card> : (<>
        {/* the whole journey as one bar, each stage as wide as it is long */}
        {journey.length > 0 && (
          <Card>
            <div className="flex h-4 w-full overflow-hidden rounded-full">
              {journey.map((s: any, i: number) => (
                <div key={i} title={stageName(s, lang)} style={{ flexGrow: s.months, background: KIND[s.kind]?.color }} className="h-full border-r-2 border-[var(--card)] last:border-r-0" />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-xs text-[var(--muted)]">
              <span>{year0}</span><span>{year0 + Math.ceil(tot.months_to_job / 12)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {Object.entries(KIND).filter(([k]) => r.stages.some((s: any) => s.kind === k)).map(([k, v]) => (
                <span key={k} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: v.color }} />{t(`rm_kind_${k}`)}</span>
              ))}
            </div>
          </Card>
        )}

        {/* money summary */}
        <Card>
          <div className="grid grid-cols-2 gap-2">
            <Tile label={t("rm_total_cost")} value={range(tot.cost_low, tot.cost_high)} />
            <Tile label={t("rm_scholarships")} value={tot.scholarship_high ? `− ${range(tot.scholarship_low, tot.scholarship_high)}` : "—"} tone="good" />
            <Tile label={t("rm_stipend")} value={tot.stipend ? `− ${inr(tot.stipend)}` : "—"} tone="good" />
            <Tile label={t("rm_family_pays")} value={range(tot.net_low, tot.net_high)} strong
              sub={tot.net_high && tot.months_to_job ? t("rm_per_month", { v: range(tot.per_month_low, tot.per_month_high) }) : undefined} />
          </div>
          {r.income && (
            <div className="mt-2 flex items-center justify-between rounded-xl bg-emerald-50 p-3 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
              <div>
                <div className="text-xs">{t("rm_first_salary")}</div>
                <div className="text-lg font-bold">{inr(r.income.median)}<span className="text-xs font-normal">/{t("rm_month")}</span></div>
                {r.income.low !== r.income.high && <div className="text-xs">{range(r.income.low, r.income.high)}</div>}
              </div>
              {r.payback && (
                <div className="text-right text-xs">
                  <div>{t("rm_payback")}</div>
                  <div className="text-base font-semibold">{paybackLine(t, r.payback.high_cost)}</div>
                </div>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-[var(--muted)]">{t("rm_cost_note")}</p>
          {tot.estimated_stages > 0 && <p className="mt-1"><Badge tone="amber"> {t("rm_estimates", { n: tot.estimated_stages })}</Badge></p>}
        </Card>

        {/* the road itself */}
        <Card>
          <ol className="relative">
            {r.stages.map((s: any, i: number) => {
              const k = KIND[s.kind] || KIND.course;
              const last = i === r.stages.length - 1;
              const y1 = year0 + Math.floor(s.start_month / 12);
              const y2 = year0 + Math.floor((s.start_month + Math.max(s.months, 1) - 1) / 12);
              return (
                <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
                  {!last && <span aria-hidden className="absolute left-[19px] top-10 bottom-0 w-1 rounded-full" style={{ background: `linear-gradient(${k.color}, ${KIND[r.stages[i + 1].kind]?.color})` }} />}
                  {s.now ? (
                    // Maina stands on the road where the student is now
                    <span className="relative z-10 h-10 w-10 shrink-0">
                      <span aria-hidden className="absolute inset-x-1 bottom-0 h-2 rounded-full bg-amber-300/70" />
                      <Mascot pose="wave" size={60} className="absolute -left-2.5 -top-5" />
                    </span>
                  ) : (
                    <span className="relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg shadow" style={{ background: k.color }}><Icon name={k.icon} size={20} className="text-white" /></span>
                  )}
                  <div className="min-w-0 flex-1 rounded-xl bg-[var(--bg)] p-3">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
                      {s.now && <span className="rounded-full bg-amber-300 px-2 py-0.5 font-bold text-black">{t("rm_you_are_here")}</span>}
                      <span>{t("rm_step", { n: i + 1 })}</span>
                      {s.kind !== "job" && <span>· {y1 === y2 ? y1 : `${y1}–${y2}`}</span>}
                      {s.months > 0 && <span>· {duration(t, s.months)}</span>}
                    </div>
                    <h3 className="mt-0.5 font-bold leading-snug">{stageName(s, lang)}</h3>

                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                      {s.kind !== "job" && s.kind !== "earn" && (
                        <span className="rounded-full bg-[var(--card)] px-2 py-0.5 font-semibold ring-1 ring-black/10">
                           {s.fee_high ? range(s.fee_low, s.fee_high) : t("rm_free")}
                        </span>
                      )}
                      {s.stipend_per_month > 0 && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-900">+{inr(s.stipend_per_month)}/{t("rm_month")} {t("rm_stipend_short")}</span>
                      )}
                      {s.scholarship && (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-900">{t("rm_scholarship_upto", { v: inr(s.scholarship.value) })}</span>
                      )}
                      {s.estimate && s.kind !== "job" && <Badge tone="amber">{t("estimate")}</Badge>}
                    </div>

                    {s.kind === "job" && r.income && (
                      <div className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                         <b>{inr(r.income.median)}</b>/{t("rm_month")} {r.income.low !== r.income.high && <span className="text-xs">({range(r.income.low, r.income.high)})</span>}
                        <div className="text-xs opacity-80">{r.career.income_text}</div>
                      </div>
                    )}

                    <p className="mt-2 text-sm">{s.what}</p>
                    {s.scholarship && <p className="mt-1 text-xs text-[var(--muted)]">{s.scholarship.names.join(", ")}</p>}
                    {s.exams.map((e: any) => (
                      <p key={e.id} className="mt-1 text-xs text-[var(--muted)]">{e.name}: {e.timing}{e.fee !== null ? ` · ${t("rm_fee")} ${inr(e.fee)}` : ""}
                        {e.site && <> · <a className="underline" href={e.site} target="_blank" rel="noreferrer">{t("rm_apply")}</a></>}</p>
                    ))}
                    {s.stipend_text && <p className="mt-1 text-xs text-[var(--muted)]">{s.stipend_text}</p>}
                    {s.plan_id && <Link href={`/plan/?id=${s.plan_id}`} className="mt-1 inline-block text-xs font-semibold text-[var(--brand-ink)] underline">{t("rm_full_plan")} ›</Link>}
                    <div className="mt-1 text-[11px] text-[var(--muted)]">
                      {s.estimate && s.kind !== "job" ? <span>{t("rm_fee_status")}: {s.status}</span> : <Source url={s.kind === "job" ? r.career.sources?.[0] : s.stipend_source || s.source}
                        label={s.kind === "job" ? undefined : s.stipend_source || s.source ? undefined : s.fee_from} />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {/* the end of the road: Maina plants her flag */}
          <Mascot pose="flag" size={68} className="mt-3">
            <p className="text-sm font-semibold text-[var(--brand-ink)]">{t("rm_finish", { y: year0 + Math.ceil(tot.months_to_job / 12) })}</p>
          </Mascot>
        </Card>

        <button onClick={makeMine}
          disabled={isMine}
          className={`w-full rounded-xl py-3 font-semibold ${isMine ? "bg-emerald-100 text-emerald-900" : "bg-[var(--brand)] text-white"}`}>
          {isMine ? t("rm_saved") : t("rm_make_mine")}
        </button>

      </>)}
      <p className="text-center text-xs text-[var(--muted)]">{t("rm_footer", { file: data.version.file })}</p>
      {cheer && (
        <div role="status" className="pointer-events-none fixed inset-x-0 bottom-8 z-50 flex justify-center px-4">
          <Mascot pose="cheer" size={110} stack><p className="text-base font-bold">{t("rm_saved")}</p></Mascot>
        </div>
      )}
    </>
  );
}

function paybackLine(t: any, m: number | null) {
  if (m === null) return t("rm_payback_long");
  if (m === 0) return t("rm_payback_covered");
  return t("rm_payback_months", { m });
}

function Tile({ label, value, sub, tone, strong }: { label: string; value: string; sub?: string; tone?: "good"; strong?: boolean }) {
  return (
    <div className={`rounded-xl p-2.5 ${strong ? "bg-[var(--brand-soft)]" : "bg-[var(--bg)]"}`}>
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className={`text-sm font-bold ${tone === "good" ? "text-[var(--good)]" : ""} ${strong ? "text-base text-[var(--brand-ink)]" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

export default function RoadmapPage() {
  const { t } = useApp();
  return (
    <Shell title={t("rm_title")} back="/careers/">
      <Suspense><RoadmapView /></Suspense>
    </Shell>
  );
}
