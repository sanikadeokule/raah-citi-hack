"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Card, Shell, Source } from "@/components/ui";
import { useApp } from "@/lib/store";
import { postAi } from "@/lib/ai";
import { BUILD_ROADMAP_HREF } from "@/lib/roadmap";

function DistanceBadge({ centre, t }: { centre: any; t: (k: string) => string }) {
  if (centre.distance_km == null) return null;
  return (
    <span className="ml-1 text-xs text-[var(--muted)]">
      {centre.approximate ? `~${centre.distance_km}` : centre.distance_km} {t("colleges_km")}
      {centre.approximate ? ` (${t("colleges_approx")})` : ""}
    </span>
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

  useEffect(() => {
    if (!careerId || !profile) return;
    setLoading(true);
    postAi("/api/chat/colleges", { profile, career_id: careerId, lang })
      .then((r) => setResult(r))
      .finally(() => setLoading(false));
  }, [careerId, lang, profile]);

  const noRoadmap = !careerId;
  const centres: any[] = result?.centres ?? [];
  const courses: any[] = result?.courses ?? [];
  const summary: string | null = result?.summary ?? null;

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
            {summary && (
              <p className="mt-2 text-sm leading-relaxed">✨ {summary}</p>
            )}
          </Card>

          {/* Training centres */}
          <Card>
            <h2 className="mb-3 font-bold">🏫 {t("colleges_centres")}</h2>
            {loading && <p className="text-sm text-[var(--muted)] animate-pulse">Loading…</p>}
            {!loading && centres.length === 0 && (
              <p className="text-sm text-[var(--muted)]">{t("colleges_no_centres")}</p>
            )}
            <ul className="space-y-3">
              {centres.map((c: any) => (
                <li key={c.id} className="rounded-xl bg-[var(--bg)] p-3 ring-1 ring-black/5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold leading-snug">{c.name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {[c.type, c.taluka, c.district].filter(Boolean).join(" · ")}
                        <DistanceBadge centre={c} t={t} />
                      </p>
                    </div>
                    {c.fees_text && (
                      <Badge tone={c.fees_text.toLowerCase().includes("free") ? "green" : undefined}>
                        {c.fees_text.toLowerCase().includes("free") ? t("colleges_free") : c.fees_text}
                      </Badge>
                    )}
                  </div>
                  {c.courses && <p className="mt-1 text-xs text-[var(--muted)]">{c.courses}</p>}
                  {c.address && <p className="mt-1 text-xs text-[var(--muted)]">{c.address}</p>}
                  {c.source && <Source url={c.source} date={c.last_checked} />}
                </li>
              ))}
            </ul>
          </Card>

          {/* Online courses */}
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
