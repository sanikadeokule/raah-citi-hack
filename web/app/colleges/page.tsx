"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Card, Shell, Source } from "@/components/ui";
import { getKV, setKV } from "@/lib/db";
import { useApp } from "@/lib/store";
import { postAi } from "@/lib/ai";
import { BUILD_ROADMAP_HREF } from "@/lib/roadmap";

const PAGE_SIZE = 5;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function CentreCard({ c, t }: { c: any; t: (k: string) => string }) {
  const [open, setOpen] = useState(false);
  const isFree = c.fees_text?.toLowerCase().includes("free");
  return (
    <li className="rounded-xl bg-[var(--bg)] ring-1 ring-black/5 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-3 text-left"
      >
        <span className="font-semibold leading-snug flex-1 min-w-0 truncate">{c.name}</span>
        <div className="flex items-center gap-2 shrink-0">
          {c.fees_text && (
            <Badge tone={isFree ? "green" : undefined}>
              {isFree ? t("colleges_free") : c.fees_text}
            </Badge>
          )}
          <span className="text-[var(--muted)] text-xs">{open ? "▲" : "▼"}</span>
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1 border-t border-black/5 pt-2">
          <p className="text-xs text-[var(--muted)]">
            {[c.type, c.taluka, c.district].filter(Boolean).join(" · ")}
            {c.distance_km != null && (
              <span> · {c.approximate ? `~${c.distance_km}` : c.distance_km} {t("colleges_km")}{c.approximate ? ` (${t("colleges_approx")})` : ""}</span>
            )}
          </p>
          {c.courses && <p className="text-xs text-[var(--muted)]">{c.courses}</p>}
          {c.address && <p className="text-xs text-[var(--muted)]">{c.address}</p>}
          {c.source && <Source url={c.source} date={c.last_checked} />}
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
  const centres: any[] = result?.centres ?? [];
  const courses: any[] = result?.courses ?? [];
  const summary: string | null = result?.summary ?? null;

  const totalCentrePages = Math.ceil(centres.length / PAGE_SIZE);
  const pagedCentres = centres.slice(centrePage * PAGE_SIZE, (centrePage + 1) * PAGE_SIZE);

  return (
    <Shell title={t("colleges_title")}>
      {noRoadmap ? (
        <Card className="text-center space-y-3">
          <p className="text-4xl">🎓</p>
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
            {summary && <p className="mt-2 text-sm leading-relaxed">✨ {summary}</p>}
          </Card>

          <Card>
            <h2 className="mb-3 font-bold">🏫 {t("colleges_centres")}</h2>
            {loading && <p className="text-sm text-[var(--muted)] animate-pulse">Loading…</p>}
            {!loading && centres.length === 0 && (
              <p className="text-sm text-[var(--muted)]">{t("colleges_no_centres")}</p>
            )}
            <ul className="space-y-2">
              {pagedCentres.map((c: any) => (
                <CentreCard key={c.id} c={c} t={t} />
              ))}
            </ul>
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
              <h2 className="mb-3 font-bold">💻 {t("colleges_online")}</h2>
              {loading && courses.length === 0 && (
                <p className="text-sm text-[var(--muted)] animate-pulse">Loading…</p>
              )}
              <ul className="space-y-3">
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
