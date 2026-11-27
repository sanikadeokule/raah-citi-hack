"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { Card, Source } from "@/components/ui";
import { Pager, usePaged } from "@/components/pager";
import { useApp } from "@/lib/store";
import { becauseText, rankFor, studentGaps } from "@/lib/gaps";
import { tagLabel } from "@/lib/questions";

// Free online courses (Skill India, SWAYAM, DIKSHA) from the dataset. "For you" shows the few that fix the student's gaps for her
// career (lib/gaps.ts), each with a "Because..." reason; "See all free courses" keeps the whole list one tap away.
const LANGUAGE: Record<string, string> = { en: "english", hi: "hindi", mr: "marathi" };
const SHOWN = 3;

export function FreeCourses() {
  const { t, data, profile, lang } = useApp();
  const [platform, setPlatform] = useState("all");
  const [all, setAll] = useState(false);
  const g = useMemo(() => studentGaps(data, profile), [data, profile]);
  const platforms: string[] = useMemo(() => [...new Set<string>((data?.courses ?? []).map((c: any) => c.platform))], [data]);
  // her language first among equally good fits
  const picks = useMemo(() => rankFor<any>(data?.courses ?? [], g, (c) => (String(c.language).toLowerCase() === LANGUAGE[lang] ? 0.5 : 0)), [data, g, lang]);
  const reasonOf = new Map<string, any>(picks.map((p) => [p.item.id, p.reason]));
  const showAll = all || picks.length === 0;
  const list = useMemo(() => {
    const rows = (data?.courses ?? []).filter((c: any) => platform === "all" || c.platform === platform);
    return [...rows].sort((a: any, b: any) => Number(reasonOf.has(b.id)) - Number(reasonOf.has(a.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, platform, picks]);
  const pg = usePaged(list, 5, `${platform}|${g.careerId}`);
  const card = (c: any) => (
    <li key={c.id}>
      <Card className="space-y-1">
        {reasonOf.has(c.id) && <span className="inline-block rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand-ink)]">{becauseText(t, tagLabel, reasonOf.get(c.id))}</span>}
        <a className="block font-semibold leading-snug underline" href={c.source} target="_blank" rel="noreferrer">{c.title}</a>
        <p className="text-xs text-[var(--muted)]">{c.platform}{c.provider ? ` · ${c.provider}` : ""}</p>
        <p className="text-xs text-[var(--muted)]">{c.language} · {c.fee_text} · {c.duration}</p>
        {c.career_text && <p className="text-xs text-[var(--muted)]">{t("fc_for")}: {c.career_text}</p>}
        <Source url={c.source} date={c.last_checked} />
      </Card>
    </li>
  );
  if (!showAll) {
    return (
      <>
        <p className="text-xs text-[var(--muted)]">{t("fc_for_you_note", { career: g.careerName || t("your_profile") })}</p>
        <ul className="space-y-2">{picks.slice(0, SHOWN).map((p) => card(p.item))}</ul>
        <button onClick={() => setAll(true)} className="w-full rounded-xl py-2 text-sm font-semibold text-[var(--brand-ink)] underline">{t("fc_see_all", { n: data?.courses?.length ?? 0 })}</button>
      </>
    );
  }
  return (
    <>
      {picks.length > 0 && <button onClick={() => setAll(false)} className="text-sm font-semibold text-[var(--brand-ink)] underline">{t("fc_back_for_you")}</button>}
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
        {pg.pageItems.map(card)}
      </ul>
      <Pager page={pg.page} pages={pg.pages} start={pg.start} shown={pg.pageItems.length} total={pg.total} go={pg.go} />
    </>
  );
}
