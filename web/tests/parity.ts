// Usage: tsx tests/parity.ts <input.json>  -> prints engine results as JSON (compared by backend/tests/test_parity.py)
import { readFileSync } from "node:fs";
import { computePlan, eligibility, eligibilityChanges, rankCareers } from "../lib/engine";

const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
const { data, cases } = input;
const out = cases.map((c: any) => {
  const r = computePlan(data, c.profile, c.plan_id, c.options);
  return {
    costs: r.costs, net_cost: r.net_cost, scholarship: { low: r.scholarship.low, high: r.scholarship.high, chosen: r.scholarship.chosen },
    stipend: r.stipend.total, payback: r.payback, family_gap: r.family_gap, last: r.series[r.series.length - 1],
    centres: r.centres.map((x: any) => [x.id, x.distance_km]),
    elig: eligibility(data, c.profile).map((e: any) => [e.id, e.status, e.passed, e.total]),
    rank: rankCareers(data, c.profile).map((s: any) => [s.career.id, s.score, s.fit, s.diversity, s.why]),
    rank_for: (c.interests_cases || []).map((i: string[]) => rankCareers(data, { ...c.profile, interests: i }).map((s: any) => [s.career.id, s.score, s.fit, s.why])),
    elig_plan: eligibility(data, c.profile, data.plans.find((p: any) => p.id === c.plan_id), c.options.hostel).map((e: any) => [e.id, e.status]),
    changes: eligibilityChanges(data, c.profile, data.plans.find((p: any) => p.id === c.plan_id), c.options.hostel),
  };
});
process.stdout.write(JSON.stringify(out));
