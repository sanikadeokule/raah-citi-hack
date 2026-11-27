"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Icon } from "@/components/icon";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Card, Shell, Source } from "@/components/ui";
import { getKV, setKV } from "@/lib/db";
import { useApp } from "@/lib/store";
import { placeLabel } from "@/lib/questions";
import { CentreMap } from "@/components/centremap";
import { postAi } from "@/lib/ai";
import { BUILD_ROADMAP_HREF } from "@/lib/roadmap";
import { ExamsList } from "@/components/exams";
import { Tabs } from "@/components/tabs";
import { MODULE_COLOR, ModuleHero } from "@/components/modulehero";
import { CHANCE_TEXT, chanceFor } from "@/lib/chance";
import { centreTypeLabel } from "@/lib/labels";

const PAGE_SIZE = 5;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function typeColor(type: string | undefined) {
  if (!type) return { bg: "bg-[var(--brand-soft)]", text: "text-[var(--brand-ink)]" };
  const t = type.toLowerCase();
  if (t.includes("govt")) return { bg: "bg-teal-50 dark:bg-teal-900/30", text: "text-teal-700 dark:text-teal-300" };
  if (t.includes("private")) return { bg: "bg-blue-50 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300" };
  if (t.includes("poly")) return { bg: "bg-purple-50 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-300" };
  if (t.includes("gnm") || t.includes("anm") || t.includes("nurs")) return { bg: "bg-pink-50 dark:bg-pink-900/30", text: "text-pink-700 dark:text-pink-300" };
  return { bg: "bg-[var(--brand-soft)]", text: "text-[var(--brand-ink)]" };
}

function cleanFees(fees: string | undefined): { label: string; isFree: boolean } | null {
  if (!fees) return null;
  if (fees.toLowerCase().startsWith("not in source")) return null;
  const isFree = fees.toLowerCase().includes("free");
  // strip trailing dataset annotations like "- trade list not in source"
  const cleaned = fees.replace(/\s*[-–]\s*(trade list |info )?not in source.*$/i, "").trim();
  return cleaned ? { label: cleaned, isFree } : null;
}

function cleanCourses(courses: string | undefined): string | null {
  if (!courses) return null;
  return courses.replace(/\s*[-–]\s*(trade list |info )?not in source.*$/i, "").trim() || null;
}

const CHANCE_TONE = { safe: "green", good: "blue", reach: "amber" } as const;

// the detail panel (its own column on very wide screens, or the accordion body below lg) for one centre
function CentreDetail({ c, t }: { c: any; t: (k: string) => string }) {
  const fees = cleanFees(c.fees_text);
  const courses = cleanCourses(c.courses);
  const distLabel = c.distance_km != null
    ? `${c.approximate ? "~" : ""}${c.distance_km} ${t("colleges_km")}${c.approximate ? ` (${t("colleges_approx")})` : ""}`
    : null;
  return (
    <div className="space-y-2">
      {distLabel && (
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <Icon name="pin" size={16} />
          <span>{distLabel}</span>
        </div>
      )}
      {fees ? (
        <div className="flex items-center gap-2 text-xs">
          <Icon name="rupee" size={16} />
          <span className={fees.isFree ? "font-semibold text-green-700 dark:text-green-400" : "text-[var(--muted)]"}>{fees.label}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <Icon name="rupee" size={16} />
          <span>{t("fees_not_listed")}</span>
        </div>
      )}
      {courses && (
        <div className="flex items-start gap-2 text-xs text-[var(--muted)]">
          <Icon name="graduation" size={16} className="mt-0.5" />
          <span>{courses}</span>
        </div>
      )}
      {c.address && (
        <div className="flex items-start gap-2 text-xs text-[var(--muted)]">
          <Icon name="building" size={16} className="mt-0.5" />
          <span>{c.address}</span>
        </div>
      )}
      {c.source && (
        <div className="pt-1">
          <Source url={c.source} date={c.last_checked} />
        </div>
      )}
    </div>
  );
}

function CentreCard({ c, t, profile, lang, selected, onSelect }: { c: any; t: (k: string) => string; profile: any; lang: string; selected?: boolean; onSelect?: () => void }) {
  const [open, setOpen] = useState(false);
  const chance = chanceFor(c, profile);
  const ct = CHANCE_TEXT[lang] ?? CHANCE_TEXT.en;
  const color = typeColor(c.type);
  const fees = cleanFees(c.fees_text);
  const distLabel = c.distance_km != null
    ? `${c.approximate ? "~" : ""}${c.distance_km} ${t("colleges_km")}${c.approximate ? ` (${t("colleges_approx")})` : ""}`
    : null;

  return (
    <li className={`rounded-2xl bg-[var(--card)] ring-1 overflow-hidden shadow-sm ${selected ? "ring-2 ring-[var(--brand)]" : "ring-black/8"}`}>
      <button
        onClick={() => { setOpen((v) => !v); onSelect?.(); }}
        className="w-full flex items-start gap-3 px-4 py-3 text-left"
      >
        {/* left color accent */}
        <span className={`mt-1 h-8 w-1 shrink-0 rounded-full ${color.bg.replace("bg-", "bg-").replace("50", "400").replace("900/30", "500")}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-sm leading-snug">{c.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={CHANCE_TONE[chance.level]}>{ct[chance.level]}</Badge>
            {chance.farAway && <span className="text-[10px] text-[var(--muted)]">{ct.far}</span>}
            {chance.needsMarks && <span className="text-[10px] text-[var(--muted)]">{ct.no_marks}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {c.type && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${color.bg} ${color.text}`}>
                {centreTypeLabel(c.type, lang)}
              </span>
            )}
            {(c.taluka || c.district) && (
              <span className="text-[11px] text-[var(--muted)]">
                {[c.taluka, c.district].filter(Boolean).map((x: string) => placeLabel(t, x)).join(", ")}
              </span>
            )}
          </div>
          {!open && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {distLabel && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg)] px-2 py-0.5 text-[10px] text-[var(--muted)] ring-1 ring-black/8">
                  <Icon name="pin" size={14} className="mr-1 align-[-2px]" />{distLabel}
                </span>
              )}
              {fees && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${fees.isFree ? "bg-green-50 text-green-700 ring-green-200 dark:bg-green-900/30 dark:text-green-300 dark:ring-green-800" : "bg-[var(--bg)] text-[var(--muted)] ring-black/8"}`}>
                  <Icon name="rupee" size={14} className="mr-1 align-[-2px]" />{fees.isFree ? t("colleges_free") : fees.label}
                </span>
              )}
            </div>
          )}
        </div>
        <span className="mt-1 shrink-0 text-[var(--muted)] text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-black/6 px-4 py-3 bg-[var(--bg)] xl:hidden">
          <CentreDetail c={c} t={t} />
        </div>
      )}
    </li>
  );
}

export default function CollegesPage() {
  const { t, data, profile, lang } = useApp();
  const careerId = (profile as any)?.roadmap_career as string | undefined;
  const careerName = careerId
    ? (data?.careers as any[] | undefined)?.find((c: any) => c.id === careerId)?.name
    : undefined;

  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [centrePage, setCentrePage] = useState(0);
  const [tab, setTab] = useState<"colleges" | "exams">("colleges");
  const [chanceFilter, setChanceFilter] = useState<"all" | "safe" | "good" | "reach">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!careerId || !profile) return;
    const cacheKey = `colleges_${careerId}_${lang}`;
    // try KV cache first
    getKV(cacheKey).then((cached: any) => {
      if (cached && cached._ts && Date.now() - cached._ts < CACHE_TTL_MS) {
        setResult(cached);
        return;
      }
      setLoading(true);
      postAi("/api/chat/colleges", { profile, career_id: careerId, lang })
        .then((r) => {
          const withTs = { ...r, _ts: Date.now() };
          setResult(withTs);
          setKV(cacheKey, withTs);
        })
        .finally(() => setLoading(false));
    });
    setCentrePage(0);
  }, [careerId, lang, profile]);

  const noRoadmap = !careerId;
  const allCentres: any[] = result?.centres ?? [];
  const courses: any[] = result?.courses ?? [];
  const summary: string | null = result?.summary ?? null;
  const centres = chanceFilter === "all" ? allCentres : allCentres.filter((c) => chanceFor(c, profile).level === chanceFilter);
  const chanceCount = (lvl: "safe" | "good" | "reach") => allCentres.filter((c) => chanceFor(c, profile).level === lvl).length;

  const totalCentrePages = Math.ceil(centres.length / PAGE_SIZE);
  const pagedCentres = centres.slice(centrePage * PAGE_SIZE, (centrePage + 1) * PAGE_SIZE);
  const selected = pagedCentres.find((c: any) => c.id === selectedId) ?? pagedCentres[0] ?? null;

  return (
    <Shell title={t("colleges_title")} wide>
      {/* Maina in her graduation cap; she thinks while the colleges load */}
      <ModuleHero color={MODULE_COLOR.colleges} item="cap" pose={loading ? "think" : "wave"}
        line={careerName ? t("hero_colleges", { career: careerName }) : t("hero_colleges_none")}
        stats={centres.length ? [{ icon: "building", value: centres.length, label: t("hero_stat_centres") }, ...(courses.length ? [{ icon: "book", value: courses.length, label: t("hero_stat_courses") }] : [])] : []} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "exams", label: `${t("home_exams")}` }, { key: "colleges", label: `${t("adm_tab_colleges")}` }]} />
      {tab === "exams" ? <ExamsList /> : noRoadmap ? (
        <Card className="text-center space-y-3">
          <Icon name="graduation" size={40} className="text-[var(--brand)]" />
          <p className="text-sm text-[var(--muted)]">{t("colleges_no_roadmap")}</p>
          <Link href={BUILD_ROADMAP_HREF}
            className="inline-block rounded-xl bg-[var(--brand)] px-5 py-2 text-sm font-semibold text-white">
            {t("home_discover")} →
          </Link>
        </Card>
      ) : (
        <>
          <Card className="space-y-1">
            <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">{t("home_careers")}</p>
            <p className="text-lg font-bold text-[var(--brand-ink)]">{careerName ?? careerId}</p>
            {summary && <p className="mt-2 text-sm leading-relaxed">{summary}</p>}
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">{t("colleges_centres")}</h2>
              <div className="flex flex-wrap gap-1.5">
                {([["all", t("colleges_filter_all"), allCentres.length], ["safe", CHANCE_TEXT[lang]?.safe ?? CHANCE_TEXT.en.safe, chanceCount("safe")], ["good", CHANCE_TEXT[lang]?.good ?? CHANCE_TEXT.en.good, chanceCount("good")], ["reach", CHANCE_TEXT[lang]?.reach ?? CHANCE_TEXT.en.reach, chanceCount("reach")]] as const).map(([key, label, n]) => (
                  <button key={key} onClick={() => { setChanceFilter(key); setCentrePage(0); setSelectedId(null); }}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${chanceFilter === key ? "bg-[var(--brand)] text-white ring-[var(--brand)]" : "bg-[var(--bg)] text-[var(--muted)] ring-black/10"}`}>
                    {label}{key !== "all" ? ` (${n})` : ""}
                  </button>
                ))}
              </div>
            </div>
            {loading && <p className="mt-3 text-sm text-[var(--muted)] animate-pulse">Loading…</p>}
            {!loading && centres.length === 0 && (
              <p className="mt-3 text-sm text-[var(--muted)]">{t("colleges_no_centres")}</p>
            )}
            <div className="mt-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_20rem]">
            {!loading && pagedCentres.some((c: any) => c.lat != null) && (
<div className="lg:sticky lg:top-32">
              <CentreMap centres={pagedCentres.filter((c: any) => c.lat != null).map((c: any) => ({ ...c, approximate: c.approximate ?? c.coord_source !== "exact", highlighted: c.id === selected?.id }))}
                home={{ lat: profile?.lat, lon: profile?.lon, label: placeLabel(t, profile?.taluka) || t("your_profile") }} />
              </div>
            )}
            <ul className="space-y-2">
              {pagedCentres.map((c: any) => (
                <CentreCard key={c.id} c={c} t={t} profile={profile} lang={lang} selected={c.id === selected?.id} onSelect={() => setSelectedId(c.id)} />
              ))}
            </ul>
            {selected && (
              <div className="hidden rounded-2xl bg-[var(--bg)] p-4 ring-1 ring-black/8 xl:block xl:sticky xl:top-32">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{centreTypeLabel(selected.type, lang) || t("colleges_centres")}</p>
                <p className="mt-0.5 text-lg font-bold leading-snug">{selected.name}</p>
                <div className="mt-2"><CentreDetail c={selected} t={t} /></div>
              </div>
            )}
            </div>
            {totalCentrePages > 1 && (
              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  onClick={() => setCentrePage((p) => Math.max(0, p - 1))}
                  disabled={centrePage === 0}
                  className="rounded-lg px-3 py-1 text-sm font-semibold bg-[var(--bg)] ring-1 ring-black/10 disabled:opacity-40"
                >
                  ← {t("colleges_prev")}
                </button>
                <span className="text-xs text-[var(--muted)]">{centrePage + 1} / {totalCentrePages}</span>
                <button
                  onClick={() => setCentrePage((p) => Math.min(totalCentrePages - 1, p + 1))}
                  disabled={centrePage === totalCentrePages - 1}
                  className="rounded-lg px-3 py-1 text-sm font-semibold bg-[var(--bg)] ring-1 ring-black/10 disabled:opacity-40"
                >
                  {t("colleges_next")} →
                </button>
              </div>
            )}
          </Card>

          {(courses.length > 0 || loading) && (
            <Card>
              <h2 className="mb-3 font-bold">{t("colleges_online")}</h2>
              {loading && courses.length === 0 && (
                <p className="text-sm text-[var(--muted)] animate-pulse">Loading…</p>
              )}
              <ul className="space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
                {courses.map((c: any) => (
                  <li key={c.id} className="rounded-xl bg-[var(--bg)] p-3 ring-1 ring-black/5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold leading-snug">{c.title}</p>
                        <p className="text-xs text-[var(--muted)]">{c.platform}{c.provider ? ` · ${c.provider}` : ""}</p>
                        {c.duration && <p className="text-xs text-[var(--muted)]">{c.duration}</p>}
                      </div>
                      <Badge tone={!c.fee || c.fee === 0 ? "green" : undefined}>
                        {!c.fee || c.fee === 0 ? t("colleges_free") : c.fee_text}
                      </Badge>
                    </div>
                    {c.source && <Source url={c.source} date={c.last_checked} />}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </Shell>
  );
}
