/* eslint-disable @typescript-eslint/no-explicit-any */
// What fits a student on Learn (free courses and lessons): the career she saved (else her best match), the skills that career
// needs and she has not covered yet (her "gaps"), and what she said she enjoys. Everything comes from the spreadsheet tags.
//   gap = the career's interest tags - what she said she is good at - tags of lessons she finished
// Each match comes with a reason, shown as a "Because..." chip; nothing is hidden, "See all" shows the full list.
import { rankCareers } from "./engine";
import { myCareer } from "./tailor";

export type Reason = { kind: "first" | "gap" | "enjoy" | "about"; career?: string; tag?: string };
export interface Tagged { career_ids?: string[]; tags?: string[] }
export interface Ranked<T> { item: T; reason: Reason; score: number }

export interface Gaps { careerId: string | null; careerName: string; top: { id: string; name: string }[]; gap: string[]; enjoy: string[] }

const norm = (s: any) => String(s).trim().toLowerCase();

export function studentGaps(data: any, profile: any, doneTags: string[] = []): Gaps {
  const mc = myCareer(data, profile);
  const have = new Set<string>([...(profile?.ikigai?.good_at ?? []), ...(profile?.strengths ?? []), ...doneTags].map(norm));
  const needed: string[] = mc?.career?.tags ?? [];
  const top = data && profile && (profile.interests || []).length
    ? rankCareers(data, profile, 5).filter((s: any) => s.fit !== "none").map((s: any) => ({ id: s.career.id, name: s.career.name }))
    : [];
  return {
    careerId: mc?.career?.id ?? null, careerName: mc?.career?.name ?? "", top,
    gap: needed.filter((tag) => !have.has(norm(tag))),
    enjoy: (profile?.interests ?? []).map(String),
  };
}

/** Score one course or lesson for the student; null when nothing links it to her. */
export function matchFor(item: Tagged, g: Gaps): Ranked<any>["reason"] & { score: number } | null {
  const ids = item.career_ids ?? [];
  const tags = (item.tags ?? []).map(norm);
  if (g.careerId && ids.includes(g.careerId)) return { kind: "first", career: g.careerName, score: 3 };
  const gapHit = g.gap.filter((x) => tags.includes(norm(x)));
  if (gapHit.length) return { kind: "gap", career: g.careerName, tag: gapHit[0], score: 2 + Math.min(gapHit.length, 3) / 10 };
  const near = g.top.find((c) => ids.includes(c.id));
  if (near) return { kind: ids.length === 1 ? "about" : "first", career: near.name, score: 1.8 };
  const enjoyHit = g.enjoy.find((x) => tags.includes(norm(x)));
  if (enjoyHit) return { kind: "enjoy", tag: enjoyHit, score: 1 };
  return null;
}

export function rankFor<T extends Tagged>(items: T[], g: Gaps, tiebreak: (x: T) => number = () => 0): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  for (const item of items) {
    const m = matchFor(item, g);
    if (m) { const { score, ...reason } = m; out.push({ item, reason, score: score + tiebreak(item) }); }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** The "Because..." sentence for a reason, in the student's language (tag names use the interest_* labels). */
export function becauseText(t: (k: string, v?: any) => string, tagLabel: (t: any, tag: string) => string, r: Reason): string {
  const tag = r.tag ? tagLabel(t, r.tag) : "";
  if (r.kind === "first") return t("because_first", { career: r.career ?? "" });
  if (r.kind === "gap") return t("because_gap", { tag, career: r.career ?? "" });
  if (r.kind === "about") return t("because_about", { career: r.career ?? "" });
  return t("because_enjoy", { tag });
}
