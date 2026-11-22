"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Badge, Card, Source } from "@/components/ui";
import { CentreMap } from "@/components/centremap";
import { useApp } from "@/lib/store";
import { placeLabel } from "@/lib/questions";

// The "what to do next" cards: where to go and what to learn now. Used on the roadmap's Get started tab and the plan page.
export function CentresCard({ centres }: { centres: any[] }) {
  const { t, profile } = useApp();
  if (!centres.length) return null;
  return (
    <Card>
      <h2 className="mb-2 text-lg font-bold">📍 {t("nearest_centres")}</h2>
      <CentreMap centres={centres} home={{ lat: profile?.lat, lon: profile?.lon, label: placeLabel(t, profile?.taluka) || t("your_profile") }} />
      <ul className="space-y-2">
        {centres.map((c: any, i: number) => (
          <li key={c.id} className="rounded-xl bg-[var(--bg)] p-3 text-sm">
            <div className="flex justify-between gap-2"><b><span className="mr-1 inline-grid h-5 w-5 place-items-center rounded-full bg-[var(--brand)] text-xs text-white">{i + 1}</span>{c.name}</b><span className="whitespace-nowrap">{c.distance_km ?? "—"} km</span></div>
            <div className="text-xs text-[var(--muted)]">{c.address} · {c.type}{c.approximate && <> · <Badge tone="amber">{t("approx_distance")}</Badge></>}</div>
            <div className="text-xs text-[var(--muted)]">Fees: {c.fees_text}</div>
            <Source url={c.source} date={c.last_checked} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function CoursesCard({ courses }: { courses: any[] }) {
  const { t } = useApp();
  if (!courses.length) return null;
  return (
    <Card>
      <h2 className="mb-2 text-lg font-bold">📚 {t("courses")}</h2>
      <ul className="space-y-2 text-sm">
        {courses.map((c: any) => (
          <li key={c.id}><a className="font-medium underline" href={c.source} target="_blank" rel="noreferrer">{c.title}</a>
            <div className="text-xs text-[var(--muted)]">{c.platform} · {c.language} · {c.fee_text} · {c.duration}</div></li>
        ))}
      </ul>
    </Card>
  );
}
