// Browser copy of backend/raah/engine.py so the planner works offline.
// Every number comes from the dataset JSON (built from raah-dataset.xlsx).
// web/tests/parity.ts checks this file and the Python engine agree.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type Data = any;
export type Profile = Record<string, any>;

export type RuleStatus = "pass" | "fail" | "unknown" | "missing_doc";
export type SchemeStatus = "eligible" | "eligible_missing_docs" | "need_info" | "not_eligible";

const num = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const threshold = (value: any, category: string) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value.by_category?.[category] ?? value.base
    : value;

const isEmpty = (v: any) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

const lowerSet = (v: any) => new Set((Array.isArray(v) ? v : [v]).map((x: any) => String(x).toLowerCase()));

export function evalRule(rule: any, ctx: Profile) {
  const { field, op, value: val } = rule;
  const docs = new Set<string>(ctx.documents || []);
  const v = ctx[field];
  let status: RuleStatus = "unknown";
  if (field === "documents" && op === "has") {
    status = (val || []).every((d: string) => docs.has(d)) ? "pass" : "missing_doc";
  } else if (val === null || val === undefined) {
    status = "unknown";
  } else if (isEmpty(v)) {
    status = "unknown";
  } else if (op === "in") {
    const vals = val.map((x: any) => String(x).toLowerCase());
    const cand = typeof v === "number" && Number.isInteger(v) ? String(v) : String(v);
    status = vals.includes(cand.toLowerCase()) ? "pass" : "fail";
  } else if (op === "any") {
    const have = lowerSet(v);
    status = val.some((x: any) => have.has(String(x).toLowerCase())) ? "pass" : "fail";
  } else if (op === "has") {
    const have = lowerSet(v);
    status = val.every((x: any) => have.has(String(x).toLowerCase())) ? "pass" : "fail";
  } else if (op === "is" || op === "==") {
    const ok = typeof val === "boolean" ? Boolean(v) === val : String(v).toLowerCase() === String(val).toLowerCase();
    status = ok ? "pass" : "fail";
  } else if (["<=", "<", ">=", ">"].includes(op)) {
    const t = num(threshold(val, ctx.category));
    const x = num(v);
    if (t === null || x === null) status = "unknown";
    else {
      const ok = op === "<=" ? x <= t : op === "<" ? x < t : op === ">=" ? x >= t : x > t;
      status = ok ? "pass" : "fail";
    }
  }
  if (status === "pass" && rule.doc && !docs.has(rule.doc)) status = "missing_doc";
  return { label: rule.label, field, status, doc: rule.doc, where: rule.where };
}

export function checkScheme(scheme: any, ctx: Profile) {
  const results = scheme.rules.map((r: any) => evalRule(r, ctx));
  const st = new Set(results.map((r: any) => r.status));
  let overall: SchemeStatus;
  if (st.has("fail")) overall = "not_eligible";
  else if (st.has("unknown")) overall = "need_info";
  else if (st.has("missing_doc")) overall = "eligible_missing_docs";
  else overall = results.length ? "eligible" : "need_info";
  const missing: { doc: string; where: string }[] = [];
  for (const r of results) {
    if (r.status === "missing_doc" && r.doc && !missing.some((m) => m.doc === r.doc)) missing.push({ doc: r.doc, where: r.where });
  }
  return {
    id: scheme.id, name: scheme.name, status: overall,
    passed: results.filter((r: any) => r.status === "pass").length, total: results.length,
    rules: results, missing_docs: missing, amount_text: scheme.amount_text,
    apply_via: scheme.apply_via, source: scheme.source, last_checked: scheme.last_checked,
  };
}

const ORDER: Record<SchemeStatus, number> = { eligible: 0, eligible_missing_docs: 1, need_info: 2, not_eligible: 3 };

export function eligibility(data: Data, profile: Profile, plan?: any, hostel?: boolean) {
  const ctx: Profile = { ...profile };
  if (plan) {
    ctx.course_tags = plan.course_tags;
    if (plan.course_tags.includes("post_matric")) ctx.class = Math.max(Math.trunc(Number(ctx.class) || 0), 11);
  }
  if (hostel !== undefined) ctx.stays_in_hostel = hostel;
  const out = data.scholarships.filter((s: any) => s.rules.length).map((s: any) => checkScheme(s, ctx));
  out.sort((a: any, b: any) => ORDER[a.status as SchemeStatus] - ORDER[b.status as SchemeStatus] || b.passed / Math.max(b.total, 1) - a.passed / Math.max(a.total, 1));
  return out;
}

/** What choosing this plan changes against the student's situation now, so the screen can say so.
 * Most schemes depend on the student (class, category, income), not on the course; only rules on
 * course_tags (and class, for courses after Class 10) move when the plan changes. */
export function eligibilityChanges(data: Data, profile: Profile, plan: any, hostel?: boolean) {
  const now: Record<string, string> = Object.fromEntries(eligibility(data, profile, undefined, hostel).map((e: any) => [e.id, e.status]));
  const tags = new Set<string>(plan.course_tags);
  const forCourse = data.scholarships
    .filter((s: any) => s.rules.some((r: any) => r.field === "course_tags" && (r.value || []).some((v: string) => tags.has(v))))
    .map((s: any) => s.id);
  const changed = eligibility(data, profile, plan, hostel)
    .filter((e: any) => now[e.id] !== e.status)
    .map((e: any) => ({ id: e.id, name: e.name, before: now[e.id] ?? null, after: e.status }));
  return { plan_id: plan.id, for_this_course: forCourse, changed };
}

export const A = (data: Data, key: string, d = 0): number => {
  const a = data.assumptions?.[key];
  return a && a.value !== null && a.value !== undefined ? a.value : d;
};

export function benefitValue(scheme: any, gender: string, years: number, fees: number) {
  const b = scheme.benefit;
  let low = 0, high = 0;
  if (b.fee_pct) {
    const pct = gender in b.fee_pct ? b.fee_pct[gender] : Math.max(...Object.values(b.fee_pct).map((v: any) => v || 0));
    let part = ((pct || 0) / 100) * fees;
    if (b.fee_cap !== null && b.fee_cap !== undefined) part = Math.min(part, b.fee_cap * Math.max(years, fees ? 1 : 0));
    low += part; high += part;
  }
  if (b.per_year) { low += b.per_year.low * years; high += b.per_year.high * years; }
  if (b.per_month) {
    const m = b.months_per_year || 12;
    low += b.per_month.low * m * years; high += b.per_month.high * m * years;
  }
  return { low: pyRound(low), high: pyRound(high) };
}

// Python's round() uses banker's rounding; match it so both engines agree to the rupee.
export function pyRound(x: number) {
  const f = Math.floor(x), d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

export function planIncome(data: Data, plan: any, career: any, gender: string) {
  const loF = A(data, "income_low_factor", 1), hiF = A(data, "income_high_factor", 1);
  const ov = plan.income_override || {};
  const inc = career.income;
  if (ov.median !== null && ov.median !== undefined) {
    const med = ov.median, src = "Plan_Inputs (your figure)";
    return { low: ov.low ?? med * loF, median: med, high: ov.high ?? med * hiF, source: src, text: src, derived: ov.low == null };
  }
  if (!inc) return null;
  if (inc.by_gender) {
    const med = inc.by_gender[gender] ?? Math.min(...(Object.values(inc.by_gender) as number[]));
    return { low: med * loF, median: med, high: med * hiF, source: career.income_type, text: career.income_text, derived: true };
  }
  if (inc.low !== inc.high) {
    return { low: inc.low, median: (inc.low + inc.high) / 2, high: inc.high, source: career.income_type, text: career.income_text, derived: false };
  }
  const med = inc.low;
  return { low: med * loF, median: med, high: med * hiF, source: career.income_type, text: career.income_text, derived: true };
}

function paybackAfter(net: number, gain: number, horizon: number): number | null {
  if (net <= 0) return 0;
  if (gain <= 0) return null;
  const m = Math.ceil(net / gain);
  return m <= horizon ? m : null;
}

export interface PlanOptions {
  hostel?: boolean;
  commute_km?: number | null;
  scholarships?: string[] | null;
  family_contribution?: number;
  baseline?: "student" | "daily_wage";
}

export function computePlan(data: Data, profile: Profile, planId: string, opts: PlanOptions = {}) {
  const plan = data.plans.find((p: any) => p.id === planId);
  const career = data.careers.find((c: any) => c.id === plan.career_id);
  const gender = profile.gender || "F";
  const hostel = Boolean(opts.hostel);
  const months = plan.course_months;
  const years = months / 12;

  const centres = plan.centre_type ? nearestCentres(data, profile, plan.centre_type, 3) : [];
  let km: number;
  if (opts.commute_km !== undefined && opts.commute_km !== null) km = Number(opts.commute_km);
  else if (centres.length && centres[0].distance_km !== null) km = centres[0].distance_km;
  else km = Number(profile.max_commute_km || 0);

  const fees = plan.fees + plan.exam_fees;
  let living: number, livingLabel: string;
  if (hostel) { living = A(data, "hostel_cost_per_month") * months; livingLabel = "Hostel"; }
  else { living = km * 2 * A(data, "fare_per_km") * A(data, "study_days_per_year") * years; livingLabel = "Travel"; }
  const total = fees + plan.materials + living;

  const elig = eligibility(data, profile, plan, hostel);
  const possible = elig.filter((e: any) => e.status === "eligible" || e.status === "eligible_missing_docs");
  const byId: Record<string, any> = Object.fromEntries(data.scholarships.map((s: any) => [s.id, s]));
  const values: Record<string, { low: number; high: number }> = {};
  for (const e of possible) values[e.id] = benefitValue(byId[e.id], gender, years, fees);
  let chosen: string[] = opts.scholarships !== undefined && opts.scholarships !== null
    ? opts.scholarships.filter((s) => s in values)
    : possible.filter((e: any) => values[e.id].low > 0).map((e: any) => e.id);
  if (!A(data, "stack_scholarships", 0) && chosen.length > 1) {
    chosen = [chosen.reduce((best, s) => (values[s].low > values[best].low ? s : best), chosen[0])];
  }
  const schLow = chosen.reduce((a, s) => a + values[s].low, 0);
  const schHigh = chosen.reduce((a, s) => a + values[s].high, 0);

  const tr = career.training_income;
  const stipendMonth = tr && plan.earn_months ? tr.low : 0;
  const stipend = stipendMonth * plan.earn_months;

  const net = total - schLow - stipend;
  const income = planIncome(data, plan, career, gender);
  const baselineMode = opts.baseline || "student";
  let base = 0;
  if (baselineMode === "daily_wage" && data.baseline) base = data.baseline.monthly[gender] || 0;
  const horizon = Math.trunc(A(data, "payback_horizon_months", 120));
  const fam = Number(opts.family_contribution ?? A(data, "default_family_contribution_per_month", 0));
  const gap = Math.max(0, total - schLow - fam * months);

  const pay: Record<string, any> = {};
  if (income) {
    for (const k of ["low", "median"] as const) {
      const pm = paybackAfter(net, income[k] - base, horizon);
      pay[k] = {
        months_after_training: pm,
        month_from_start: pm === null ? null : Math.trunc(months + plan.earn_months + pm),
        monthly_gain: pyRound(income[k] - base),
      };
    }
  }

  const series: { month: number; median: number; low: number }[] = [];
  let cumMed = 0, cumLow = 0;
  const monthlyCost = months ? (total - schLow) / months : 0;
  if (!months) { cumMed = cumLow = -(total - schLow); }
  for (let m = 0; m <= horizon; m++) {
    if (m > 0) {
      if (m <= months) { cumMed -= monthlyCost; cumLow -= monthlyCost; }
      else if (m <= months + plan.earn_months) { cumMed += stipendMonth; cumLow += stipendMonth; }
      else if (income) { cumMed += income.median - base; cumLow += income.low - base; }
    }
    series.push({ month: m, median: pyRound(cumMed), low: pyRound(cumLow) });
  }

  return {
    plan,
    career,
    inputs: { gender, hostel, commute_km: Math.round(km * 10) / 10, family_contribution: fam, baseline: baselineMode, scholarships: chosen },
    costs: { course_fees: plan.fees, exam_fees: plan.exam_fees, materials: plan.materials, living: pyRound(living), living_label: livingLabel, total: pyRound(total) },
    scholarship: {
      low: schLow, high: schHigh, chosen,
      options: possible.map((e: any) => ({ id: e.id, name: e.name, status: e.status, value: values[e.id], missing_docs: e.missing_docs })),
    },
    stipend: { per_month: stipendMonth, months: plan.earn_months, total: stipend, text: career.training_income_text },
    net_cost: pyRound(net), family_gap: pyRound(gap), income, baseline_monthly: base, payback: pay, series, centres,
    eligibility: elig,
  };
}

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 6371, rad = Math.PI / 180;
  const p1 = lat1 * rad, p2 = lat2 * rad, dp = p2 - p1, dl = (lon2 - lon1) * rad;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

export function nearestCentres(data: Data, profile: Profile, centreType: string | null, n = 3) {
  const { lat, lon } = profile;
  const out: any[] = [];
  for (const c of data.centres) {
    if (centreType && !String(c.type).toLowerCase().includes(centreType.toLowerCase())) continue;
    let d: number | null = null;
    if (lat != null && lon != null && c.lat != null) d = Math.round(haversine(lat, lon, c.lat, c.lon) * 10) / 10;
    out.push({ ...c, distance_km: d, approximate: c.coord_source !== "exact" });
  }
  out.sort((a, b) => (a.distance_km === null ? 1 : 0) - (b.distance_km === null ? 1 : 0) || (a.distance_km ?? 0) - (b.distance_km ?? 0));
  return out.slice(0, n);
}

/** Singular form, so 'computer' matches the tag 'computers' and 'phone' matches 'phones'. */
const word = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const phrase = (t: any) => String(t).toLowerCase().replace(/-/g, " ").split(/\s+/).filter(Boolean).map(word).join(" ");

const tokens = (items: any[]) => {
  const out = new Set<string>();
  for (const it of items || []) for (const w of phrase(it).split(" ")) if (w.length > 2) out.add(w);
  return out;
};

// a career that only shares tags with the direct matches counts at most half a direct match
const RELATED_WEIGHT = 0.5;
const TIER: Record<string, number> = { direct: 0, related: 1, none: 2 };

export function rankCareers(data: Data, profile: Profile, n = 5) {
  const said: Record<string, string> = {};
  for (const i of profile.interests || []) if (String(i).trim()) said[phrase(i)] = String(i).trim().toLowerCase();
  const phrases = new Set<string>(Object.keys(said));
  const cls = profile.class || 10;
  const plansByCareer: Record<string, any> = Object.fromEntries(data.plans.map((p: any) => [p.career_id, p]));
  const fam = profile.family_income_annual || 0;
  // a loose (word-level) match only counts on words that belong to one tag; 'people' is in both
  // 'helping people' and 'talking to people', so it says nothing about which one the student meant
  const wordTags: Record<string, Set<string>> = {};
  for (const c of data.careers) for (const t of c.tags || []) for (const w of tokens([t])) (wordTags[w] ||= new Set()).add(phrase(t));
  const distinctive = new Set(Object.keys(wordTags).filter((w) => wordTags[w].size === 1));
  const scored: any[] = data.careers.map((c: any) => {
    const tags = new Set([...tokens(c.tags)].filter((w) => distinctive.has(w)));
    const byPhrase: Record<string, string> = {};
    for (const t of c.tags || []) byPhrase[phrase(t)] = String(t).trim().toLowerCase();
    const exact = [...phrases].filter((p) => p in byPhrase);
    const loose = [...phrases].filter((p) => !exact.includes(p) && [...tokens([p])].some((t) => tags.has(t)));
    const direct = phrases.size ? (exact.length + 0.5 * loose.length) / phrases.size : 0;
    const minC = c.min_class || 0;
    const elig = cls >= minC ? 1.0 : minC - cls <= 2 ? 0.7 : 0.3;
    let afford = 0.5;
    const p = plansByCareer[c.id];
    if (p) {
      const cost = p.fees + p.exam_fees + p.materials;
      afford = cost <= 0.25 * fam ? 1.0 : cost <= fam ? 0.6 : 0.2;
    }
    const demand = (c.demand || 3) / 5;
    return {
      career: c, plan_id: p ? p.id : null, direct, elig, afford, demand, byPhrase,
      matched: [...exact.map((x) => byPhrase[x]).sort(), ...loose.map((x) => said[x]).sort()],
    };
  });
  // careers that share tags with the direct matches are related to the interest (e.g. 'computers' -> CNC Operator
  // -> 'machines' -> Electrician); everything else has no link to what the student said they enjoy
  const near = new Set<string>();
  for (const s of scored) if (s.direct > 0) for (const k of Object.keys(s.byPhrase)) near.add(k);
  for (const p of phrases) near.delete(p);
  const ranked = scored.map((s: any) => {
    const keys = Object.keys(s.byPhrase);
    const related = s.direct === 0 ? keys.filter((k) => near.has(k)).map((k) => s.byPhrase[k]).sort() : [];
    const interest = s.direct || (related.length ? (RELATED_WEIGHT * related.length) / keys.length : 0);
    const score = 0.5 * interest + 0.2 * s.elig + 0.2 * s.afford + 0.1 * s.demand;
    return {
      career: s.career, plan_id: s.plan_id, matched: s.matched, related,
      fit: s.direct > 0 ? "direct" : related.length ? "related" : "none",
      score: Math.round(score * 1000) / 1000, raw: score,
      breakdown: { interest: Math.round(interest * 100) / 100, eligibility: s.elig, affordability: s.afford, demand: Math.round(s.demand * 100) / 100 },
      diversity: false, has_interests: phrases.size > 0,
    };
  });
  const cmp = (a: any, b: any) => TIER[a.fit] - TIER[b.fit] || b.raw - a.raw;
  ranked.sort(cmp);
  const top = ranked.slice(0, n);
  // diversity: show at least one vocational and one non-STEM / self-employment option, but only one that
  // links to the student's interests, or in place of another career that does not
  for (const flag of ["vocational", "non_stem"]) {
    if (top.length && !top.some((s: any) => s.career.flags[flag])) {
      const last = top[top.length - 1];
      const extra = ranked.slice(n).find((s: any) => s.career.flags[flag] && (s.fit !== "none" || last.fit === "none" || !phrases.size));
      if (extra) { extra.diversity = true; top[top.length - 1] = extra; top.sort(cmp); }
    }
  }
  return top.map(({ raw, ...s }: any) => ({ ...s, why: whyLine(s) }));
}

export function whyLine(s: any) {
  const parts: string[] = [];
  if (s.matched.length) parts.push("matches your interest in " + s.matched.slice(0, 3).join(", "));
  else if (s.related?.length) parts.push("close to your interests through " + s.related.slice(0, 3).join(", "));
  if (s.breakdown.affordability >= 1) parts.push("low cost for your family");
  if (s.breakdown.demand >= 0.8) parts.push("many openings near Pune");
  if (s.career.flags.vocational) parts.push("start earning sooner");
  // never call an unrelated career a fit: say plainly why it is on the list
  if (s.fit === "none" && s.has_interests) return "A different kind of path, not linked to your interests" + (parts.length ? ": " + parts.join("; ") : "");
  return parts.length ? "Fits you: " + parts.join("; ") : "A different option worth knowing about";
}

export function inr(v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const n = Math.round(v);
  const s = String(Math.abs(n));
  let out = s;
  if (s.length > 3) {
    const head = s.slice(0, -3), tail = s.slice(-3);
    out = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + tail;
  }
  return (n < 0 ? "-₹" : "₹") + out;
}
