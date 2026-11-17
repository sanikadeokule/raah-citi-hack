// Which mentors, NAPS openings and railway seats belong to a career. Everything is read from the
// spreadsheet: mentors through their "Career IDs" column, apprenticeships by comparing the trade name
// with the career name (so a new row in either sheet is picked up without code changes).
// When a career has nothing of its own, careers that share interest tags stand in as "related".
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Data } from "./engine";

const STOP = new Set(["and", "the", "of", "cum", "any", "in", "for", "non", "with"]);
const SYNONYM: Record<string, string[]> = { ac: ["air", "conditioning"] };

export function tradeWords(s: string): Set<string> {
  const clean = String(s || "").toLowerCase()
    .replace(/\bv\s?\d+(\.\d+)*\b/g, " ") // "Warehouse Supervisor V3", "Assembly Line Operator V 4.0"
    .replace(/&/g, " and ");
  const out = new Set<string>();
  for (const w of clean.split(/[^a-z0-9]+/)) {
    if (w.length < 2 || STOP.has(w)) continue;
    for (const x of SYNONYM[w] || [w]) out.add(x);
  }
  return out;
}

// A trade belongs to a career when most of the shorter name's words appear in the longer one:
// "Machinist" ~ "Machinist / Turner", "Recruitment Executive" ~ "Recruitment / HR Executive",
// but "Mechanic (Diesel)" is not "Mechanic Refrigeration and Air Conditioning".
export function tradeMatchesCareer(trade: string, careerName: string): boolean {
  const a = tradeWords(trade), b = tradeWords(careerName);
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared > 0 && shared / Math.min(a.size, b.size) >= 0.75;
}

export type Matcher<T> = (item: T, career: any) => boolean;
export const mentorMatches: Matcher<any> = (m, c) => (m.career_ids || []).includes(c.id);
export const tradeMatches: Matcher<any> = (n, c) => tradeMatchesCareer(n.trade, c.name);

// Careers sharing at least two interest tags with the chosen ones, most shared tags first.
// (One shared tag is too loose: "helping people" would put security guards under nursing.)
const MIN_SHARED_TAGS = 2;
export function relatedCareers(data: Data, chosen: any[]): { career: any; shared: number }[] {
  const ids = new Set(chosen.map((c) => c.id));
  const tags = new Set(chosen.flatMap((c) => c.tags || []));
  return (data?.careers || [])
    .filter((c: any) => !ids.has(c.id))
    .map((c: any) => ({ career: c, shared: (c.tags || []).filter((x: string) => tags.has(x)).length }))
    .filter((r: any) => r.shared >= MIN_SHARED_TAGS)
    .sort((x: any, y: any) => y.shared - x.shared);
}

export type CareerChoice = "top" | "all" | string;

export function chosenCareers(data: Data, choice: CareerChoice, top: string[]): any[] {
  const careers = data?.careers || [];
  if (choice === "all") return careers;
  const ids = choice === "top" ? top : [choice];
  return careers.filter((c: any) => ids.includes(c.id));
}

export type Picked<T> = { items: T[]; related: any[] | null };

// items for the chosen careers; if there are none, items for the closest related careers instead
// (taking every career at the best shared-tag level that has something, so the list isn't arbitrary)
export function pickForCareers<T>(data: Data, items: T[], choice: CareerChoice, top: string[], matches: Matcher<T>): Picked<T> {
  if (choice === "all") return { items, related: null };
  const chosen = chosenCareers(data, choice, top);
  const own = items.filter((i) => chosen.some((c) => matches(i, c)));
  if (own.length) return { items: own, related: null };
  let level = -1;
  const used: any[] = [];
  for (const r of relatedCareers(data, chosen)) {
    if (level !== -1 && r.shared < level) break;
    if (items.some((i) => matches(i, r.career))) { used.push(r.career); level = r.shared; }
  }
  if (!used.length) return { items: [], related: null };
  return { items: items.filter((i) => used.some((c) => matches(i, c))), related: used };
}

// how many mentors + openings each career has, for the dropdown labels
export function countsByCareer(data: Data): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of data?.careers || []) {
    out[c.id] = (data.mentors || []).filter((m: any) => mentorMatches(m, c)).length
      + (data.naps || []).filter((n: any) => tradeMatches(n, c)).length
      + (data.railway || []).filter((n: any) => tradeMatches(n, c)).length;
  }
  return out;
}
