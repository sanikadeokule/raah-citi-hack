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
export interface Spot { career: any; plan: any; checks: Record<Circle, Check>; score: number; parts: Record<Circle, number>; pct: number }

/** How much each circle counts towards the match percentage (love 25, good at 25, pays 30, needed 20). */
export const IKIGAI_WEIGHTS: Record<Circle, number> = { love: 0.25, good: 0.25, pays: 0.3, needed: 0.2 };
const levelOf = (x: number): Level => (x >= 0.6 ? "yes" : x >= 0.3 ? "part" : "no");

/** Tags offered as quick answers; any of the dataset's tags can still be typed, spoken or added. */
export const LOVE_CHIPS = ["helping people", "machines", "computers", "animals", "farming", "art", "sports", "teaching", "business", "beauty", "clothes", "travel"];
export const GOOD_CHIPS = ["talking to people", "fixing things", "maths", "organising", "teamwork", "reading", "leadership", "hands-on", "typing", "languages", "discipline", "precision"];

// words people say that are not the dataset's own tag
const SAYS_BASE: Record<string, string | string[]> = {
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

/** Words for the finer tags added to Career_Profile (what you do, how you work). They override the base map where both name a word. */
const SAYS_MORE: Record<string, string | string[]> = {
  patient: ["helping people", "patient care"], patients: ["helping people", "patient care"], nurse: ["health", "patient care"], nursing: ["health", "patient care"],
  hospital: ["health", "hospital work"], injury: "first aid", bandage: "first aid", pregnancy: "women's health", midwife: "women's health", mothers: "women's health",
  protect: "protecting people", security: "protecting people", guard: "protecting people", police: ["government job", "protecting people", "uniform"],
  army: ["government job", "protecting people", "uniform"], uniform: "uniform", government: "government job", public: "public service",
  customer: "customer service", customers: "customer service", solve: "problem solving", solving: "problem solving", puzzle: ["maths", "problem solving"],
  logical: ["maths", "problem solving"], creative: "creativity", ideas: "creativity", imagination: "creativity", craft: "handicrafts", handmade: "handicrafts",
  tools: "using tools", tool: "using tools", install: "installing", fitting: "installing", safe: "safety", safety: "safety",
  weld: ["welding", "metal"], welding: ["welding", "metal"], wire: ["wiring", "electrical"], wiring: ["wiring", "electrical"],
  paint: ["art", "painting"], painting: ["art", "painting"], colours: "painting", engine: "repairing engines", engines: "repairing engines", motor: "repairing engines",
  factory: "assembly line", assembly: "assembly line", production: "assembly line", quality: "quality checking", inspect: "quality checking",
  records: "record keeping", files: "record keeping", paperwork: "paperwork", forms: "paperwork", excel: "data entry", bank: ["accounts", "banking"],
  savings: "banking", boss: "being your own boss", cow: ["animals", "animal care"], goat: ["animals", "animal care"], dog: ["animals", "animal care"], milk: "animal care",
  drive: ["vehicles", "driving"], driving: ["vehicles", "driving"], driver: ["vehicles", "driving"], gym: "physical fitness",
  fitness: ["sports", "physical fitness"], exercise: ["sports", "physical fitness"], running: ["sports", "physical fitness"],
};
const SAYS: Record<string, string | string[]> = { ...SAYS_BASE, ...SAYS_MORE };

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
/** Interest = 30% keyword match + 70% match by meaning (when a model could score the student's words; otherwise keywords alone). */
export const KEYWORD_SHARE = 0.3;
export type Semantic = { love?: Record<string, number>; good?: Record<string, number> };
const blend = (keyword: number, sem?: number) => (sem === undefined ? keyword : Math.min(1, KEYWORD_SHARE * keyword + (1 - KEYWORD_SHARE) * sem));

export function sweetSpots(data: any, profile: any, love: string[], good: string[], semantic: Semantic = {}): Spot[] {
  const byId = (list: any[]) => new Map(list.map((s: any) => [s.career.id, s]));
  const n = (data.careers ?? []).length;
  const lovers = byId(love.length ? rankCareers(data, { ...profile, interests: love }, n) : []);
  const goods = byId(good.length ? rankCareers(data, { ...profile, interests: good }, n) : []);
  const spots: Spot[] = [];
  // pay and openings are scored against the best in the dataset, so no figure is typed in here
  const plansOf = new Map<string, any>();
  let maxPay = 0, maxOpen = 0;
  for (const career of data.careers ?? []) {
    const plan = (data.plans ?? []).find((p: any) => p.career_id === career.id) ?? null;
    let r: any = null;
    if (plan) { try { r = computePlan(data, profile, plan.id); } catch { r = null; } }
    const openings = [...(data.naps ?? []), ...(data.railway ?? [])].filter((x: any) => tradeMatches(x, career)).length;
    plansOf.set(career.id, { plan, r, openings });
    maxPay = Math.max(maxPay, r?.income?.median || 0);
    maxOpen = Math.max(maxOpen, openings);
  }
  for (const career of data.careers ?? []) {
    const { plan, r, openings } = plansOf.get(career.id);
    const lv = lovers.get(career.id), gd = goods.get(career.id);
    // how much of what the student said this career covers (0 to 1); a related career counts for less
    const loveP = blend(Math.min(1, lv?.breakdown?.interest ?? 0), semantic.love?.[career.id]);
    const goodP = blend(Math.min(1, gd?.breakdown?.interest ?? 0), semantic.good?.[career.id]);
    let pays: Check = { level: "unknown", key: "ik_pays_unknown", text: "ik_pays_unknown" };
    let paysP = 0;
    if (r?.income?.median) {
      const base = r.baseline_monthly || 0;
      const level: Level = r.income.low > base ? "yes" : r.income.median > base ? "part" : "no";
      paysP = (r.income.median / (maxPay || 1)) * (r.income.median > base ? 1 : 0.5);
      pays = { level, key: "ik_pays", text: "ik_pays", vars: { amount: Math.round(r.income.median) } };
    }
    const demand = (Number(career.demand) || 0) / 5;
    const neededP = Math.max(demand, maxOpen ? Math.min(1, openings / maxOpen) : 0);
    const needed: Check = { level: levelOf(neededP), key: "ik_needed", text: "ik_needed", vars: { n: openings } };
    const checks: Record<Circle, Check> = {
      love: { level: loveP > 0 ? (lv?.fit && lv.fit !== "none" ? fitLevel(lv.fit) : levelOf(loveP)) : "no", key: "ik_love", text: "ik_love", vars: { tags: (lv?.matched ?? []).slice(0, 2).join(", ") } },
      good: { level: goodP > 0 ? (gd?.fit && gd.fit !== "none" ? fitLevel(gd.fit) : levelOf(goodP)) : "no", key: "ik_good", text: "ik_good", vars: { tags: (gd?.matched ?? []).slice(0, 2).join(", ") } },
      pays, needed,
    };
    const parts: Record<Circle, number> = { love: loveP, good: goodP, pays: Math.min(1, paysP), needed: neededP };
    const pct = Math.round(100 * (Object.keys(parts) as Circle[]).reduce((sum, c) => sum + IKIGAI_WEIGHTS[c] * parts[c], 0));
    spots.push({ career, plan, checks, parts, pct, score: (Object.values(checks) as Check[]).reduce((sum, c) => sum + pts(c.level), 0) });
  }
  // a career that matches nothing the student said is not a sweet spot; the rest go by match percentage
  return spots.filter((s) => s.parts.love > 0 || s.parts.good > 0).sort((a, b) => b.pct - a.pct || b.score - a.score);
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


/** The tags that most often sit beside the ones the student just named, taken from the careers themselves.
 * They become the reply chips of the follow-up question, so the next answer narrows things down. */
export function refiners(data: any, anchor: string[], have: string[], n = 3): string[] {
  const seen = new Map<string, number>();
  for (const c of data?.careers ?? []) {
    const tags: string[] = c.tags ?? [];
    const hits = tags.filter((t) => anchor.includes(t)).length;
    if (!hits) continue;
    for (const t of tags) if (!anchor.includes(t) && !have.includes(t)) seen.set(t, (seen.get(t) ?? 0) + hits);
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([t]) => t);
}
