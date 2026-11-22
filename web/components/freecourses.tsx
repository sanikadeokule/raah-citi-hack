"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { Card, Source } from "@/components/ui";
import { Pager, usePaged } from "@/components/pager";
import { coursesFor } from "@/lib/helpers";
import { useApp } from "@/lib/store";

// Free online courses (Skill India, SWAYAM, DIKSHA) from the dataset, the student's own roadmap first, five to a page.
export function FreeCourses() {
  const { t, data, profile } = useApp();
  const [platform, setPlatform] = useState("all");
  const career = (data?.careers ?? []).find((c: any) => c.id === profile?.roadmap_career);
  const plan = (data?.plans ?? []).find((p: any) => p.career_id === career?.id);
  const platforms: string[] = useMemo(() => [...new Set<string>((data?.courses ?? []).map((c: any) => c.platform))], [data]);
  const mineIds = new Set<string>(career ? coursesFor(data, career, plan).map((c: any) => c.id) : []);
  const list = useMemo(() => {
    const rows = (data?.courses ?? []).filter((c: any) => platform === "all" || c.platform === platform);
    return [...rows].sort((a: any, b: any) => Number(mineIds.has(b.id)) - Number(mineIds.has(a.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, platform, career?.id]);
  const pg = usePaged(list, 5, `${platform}|${career?.id}`);
  return (
    <>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("fc_platform")}>
        {["all", ...platforms].map((p) => (
          <button key={p} onClick={() => setPlatform(p)} aria-pressed={platform === p}
            className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-black/10 ${platform === p ? "bg-[var(--brand)] text-white" : "bg-[var(--card)]"}`}>
            {p === "all" ? t("fc_all") : p}
          </button>
        ))}
      </div>
      <div ref={pg.top} />
      <ul className="space-y-2">
        {pg.pageItems.map((c: any) => (
          <li key={c.id}>
            <Card className="space-y-1">
              {mineIds.has(c.id) && <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">⭐ {t("fc_for_you")}</span>}
              <a className="block font-semibold leading-snug underline" href={c.source} target="_blank" rel="noreferrer">{c.title}</a>
              <p className="text-xs text-[var(--muted)]">{c.platform}{c.provider ? ` · ${c.provider}` : ""}</p>
              <p className="text-xs text-[var(--muted)]">{c.language} · {c.fee_text} · {c.duration}</p>
              {c.career_text && <p className="text-xs text-[var(--muted)]">{t("fc_for")}: {c.career_text}</p>}
              <Source url={c.source} date={c.last_checked} />
            </Card>
          </li>
        ))}
      </ul>
      <Pager page={pg.page} pages={pg.pages} start={pg.start} shown={pg.pageItems.length} total={pg.total} go={pg.go} />
    </>
  );
}
