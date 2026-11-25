/* eslint-disable @typescript-eslint/no-explicit-any */
// Discover as the ikigai conversation. The student tells Raah two circles (what they love, what they are good at);
// Raah checks the other two from the dataset (what pays, what is needed near them). A career is a "sweet spot" to the
// degree the four circles overlap. Data decides, the conversation only gathers the two circles in the student's words.
import en from "@/locales/en.json";
import hi from "@/locales/hi.json";
import mr from "@/locales/mr.json";
import { computePlan, eligibility, rankCareers } from "@/lib/engine";
import { tradeMatches } from "@/lib/listings";

export type Level = "yes" | "part" | "no" | "unknown";
export type Circle = "love" | "good" | "pays" | "needed";
export interface Check { level: Level; text: string; vars?: Record<string, string | number>; key: string }
export interface Spot { career: any; plan: any; checks: Record<Circle, Check>; score: number }

/** Tags offered as quick answers; any of the dataset's tags can still be typed, spoken or added. */
export const LOVE_CHIPS = ["helping people", "machines", "computers", "animals", "farming", "art", "sports", "teaching", "business", "beauty", "clothes", "travel"];
export const GOOD_CHIPS = ["talking to people", "fixing things", "maths", "organising", "teamwork", "reading", "leadership", "hands-on", "typing", "languages", "discipline", "precision"];

// words people say that are not the dataset's own tag
const SAYS: Record<string, string | string[]> = {
  logical: ["maths", "science"], logic: ["maths", "science"], puzzle: "maths", puzzles: "maths", calculation: "maths", thinking: "research", think: "research",
  medicine: ["health", "biology"], medical: ["health", "biology"], medicines: ["health", "biology"], hospital: "health", patient: "helping people", patients: "helping people",
  household: ["organising", "hands-on"], housework: ["organising", "hands-on"], home: ["organising", "hands-on"], kitchen: "hands-on", cleaning: "organising",
  cooking: "hands-on", baby: "helping people", children: ["teaching", "helping people"], kids: ["teaching", "helping people"], elders: "helping people",
  social: "community", village: "community", friends: "talking to people", chat: "talking to people", speaking: "talking to people",
  gadgets: "electronics", internet: "computers", games: "computers", gaming: "computers", video: "technology", tech: "technology",
  chemistry: "science", physics: "science", plants: "farming", garden: "farming", nature: "environment", trees: "environment",
  police: "government job", army: "government job", railway: "government job", clerk: "office", bank: "accounts", money: "accounts", shopping: "sales",
  construction: "building", music: "art", singing: "art", dancing: "art", stitching: "clothes", fashion: "clothes",
  running: "sports", fitness: "sports", exercise: "sports", honest: "discipline", punctual: "discipline", careful: "precision",
  fix: "fixing things", repair: "fixing things", repairing: "fixing things", mechanic: "machines", mobile: "phones", phone: "phones",
  computer: "computers", coding: "programming", code: "programming", cook: "hands-on", stitch: "clothes", sewing: "clothes", tailor: "clothes",
  draw: "art", drawing: "art", paint: "art", sing: "art", dance: "art", help: "helping people", doctor: "health", nurse: "health", nursing: "health",
  teach: "teaching", teacher: "teaching", study: "reading", read: "reading", math: "maths", numbers: "maths", talk: "talking to people",
  cricket: "sports", football: "sports", kabaddi: "sports", farm: "farming", cow: "animals", goat: "animals", dog: "animals", drive: "vehicles",
  driving: "vehicles", bike: "vehicles", shop: "sales", sell: "sales", selling: "sales", makeup: "beauty", hair: "beauty", salon: "beauty",
  lead: "leadership", team: "teamwork", plan: "organising", organise: "organising", write: "typing", type: "typing", english: "languages",
  hindi: "languages", marathi: "languages", electric: "electrical", wiring: "electrical", wood: "wood", carpenter: "wood", welding: "metal",
};

const LOCALES: Record<string, Record<string, string>> = { en, hi, mr };
const norm = (s: string) => s.toLowerCase().replace(/[.,!?;:()]/g, " ").replace(/\bhouse hold\b/g, "household").replace(/\s+/g, " ").trim();

/** Tags a typed or spoken answer mentions: the tag in any of the three languages, or a common word for it. */
export function extractTags(raw: string, allTags: string[]): string[] {
  const text = ` ${norm(raw)} `;
  if (!text.trim()) return [];
  const found = new Set<string>();
  for (const tag of allTags) {
    const names = [tag, ...Object.values(LOCALES).map((l) => l[`interest_${tag}`]).filter(Boolean)].map((x) => norm(String(x)));
    // Marathi and Hindi bend a word ("प्राणी" becomes "प्राण्यांची"), so match the word without its last vowel sign
    const hit = (n: string) => (/^[a-z ]+$/.test(n) ? text.includes(` ${n} `) || text.includes(` ${n}s `) : text.includes(n.replace(/[\u093E-\u094C\u0902]+$/, "")));
    if (names.some((n) => n && hit(n))) found.add(tag);
  }
  for (const w of text.trim().split(" ")) {
    const hit = SAYS[w] ?? SAYS[w.replace(/(ing|s)$/, "")];
    for (const h of ([] as string[]).concat(hit ?? [])) if (allTags.includes(h)) found.add(h);
  }
  return [...found];
}

/** A typed answer split into the phrases the student gave ("logical things, medicine" is two). */
export const phrasesOf = (raw: string): string[] => raw.split(/[,;\n]|\band\b|\baur\b|\bआणि\b|\bऔर\b/i).map((x) => x.trim()).filter((x) => x.length > 1);

export const allTagsOf = (data: any): string[] => [...new Set<string>((data?.careers ?? []).flatMap((c: any) => c.tags ?? []))].sort();

const fitLevel = (fit?: string): Level => (fit === "direct" ? "yes" : fit === "related" ? "part" : "no");
const pts = (l: Level) => (l === "yes" ? 1 : l === "part" ? 0.5 : 0);

/** The four checks for every career, best sweet spot first. `profile` carries class, marks, category, income, taluka. */
export function sweetSpots(data: any, profile: any, love: string[], good: string[]): Spot[] {
  const byId = (list: any[]) => new Map(list.map((s: any) => [s.career.id, s]));
  const n = (data.careers ?? []).length;
  const lovers = byId(love.length ? rankCareers(data, { ...profile, interests: love }, n) : []);
  const goods = byId(good.length ? rankCareers(data, { ...profile, interests: good }, n) : []);
  const spots: Spot[] = [];
  for (const career of data.careers ?? []) {
    const plan = (data.plans ?? []).find((p: any) => p.career_id === career.id) ?? null;
    const lv = lovers.get(career.id), gd = goods.get(career.id);
    const loveL = fitLevel(lv?.fit), goodL = fitLevel(gd?.fit);
    // what it pays: the typical first salary against what the student could earn without the course
    let pays: Check = { level: "unknown", key: "ik_pays_unknown", text: "ik_pays_unknown" };
    let r: any = null;
    if (plan) { try { r = computePlan(data, profile, plan.id); } catch { r = null; } }
    if (r?.income?.median) {
      const base = r.baseline_monthly || 0;
      const level: Level = r.income.low > base ? "yes" : r.income.median > base ? "part" : "no";
      pays = { level, key: "ik_pays", text: "ik_pays", vars: { amount: Math.round(r.income.median) } };
    }
    // needed near you: real listings for this trade (NAPS, Railway), else how much demand the dataset records
    const openings = [...(data.naps ?? []), ...(data.railway ?? [])].filter((x: any) => tradeMatches(x, career)).length;
    const demand = Number(career.demand) || 0;
    const needed: Check = openings >= 3 || demand >= 4 ? { level: "yes", key: "ik_needed", text: "ik_needed", vars: { n: openings } }
      : openings >= 1 || demand === 3 ? { level: "part", key: "ik_needed", text: "ik_needed", vars: { n: openings } }
      : { level: "no", key: "ik_needed", text: "ik_needed", vars: { n: openings } };
    const checks: Record<Circle, Check> = {
      love: { level: loveL, key: "ik_love", text: "ik_love", vars: { tags: (lv?.matched ?? []).slice(0, 2).join(", ") } },
      good: { level: goodL, key: "ik_good", text: "ik_good", vars: { tags: (gd?.matched ?? []).slice(0, 2).join(", ") } },
      pays, needed,
    };
    spots.push({ career, plan, checks, score: (Object.values(checks) as Check[]).reduce((s, c) => s + pts(c.level), 0) });
  }
  // best overlap first; a career that matches nothing the student said is not a sweet spot
  return spots.filter((s) => s.checks.love.level !== "no" || s.checks.good.level !== "no")
    .sort((a, b) => b.score - a.score || (b.checks.love.level === "yes" ? 1 : 0) - (a.checks.love.level === "yes" ? 1 : 0));
}

/** Can you get there: cost, what the family pays a month, scholarships, nearest centre and the steps. */
export function reachable(data: any, profile: any, spot: Spot) {
  const plan = spot.plan;
  if (!plan) return null;
  const r = computePlan(data, profile, plan.id);
  const months = Math.max(plan.course_months || 0, 1);
  const schol = eligibility(data, profile, plan).filter((s: any) => s.status === "eligible" || s.status === "eligible_missing_docs").length;
  const gain = (r.income?.median || 0) - (r.baseline_monthly || 0);
  const payback = gain > 0 ? Math.max(1, Math.ceil((r.net_cost || 0) / gain)) : 0;
  return { payback, total: r.costs.total, net: r.net_cost, perMonth: Math.round(r.family_gap / months), schol, centre: r.centres?.[0] ?? null, steps: plan.steps as string[], planId: plan.id };
}
