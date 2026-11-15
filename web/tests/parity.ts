// Usage: tsx tests/parity.ts <input.json>  -> prints engine results as JSON (compared by backend/tests/test_parity.py)
import { readFileSync } from "node:fs";
import { computePlan, eligibility, rankCareers } from "../lib/engine";

const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
const { data, cases } = input;
const out = cases.map((c: any) => {
  const r = computePlan(data, c.profile, c.plan_id, c.options);
  return {
    costs: r.costs, net_cost: r.net_cost, scholarship: { low: r.scholarship.low, high: r.scholarship.high, chosen: r.scholarship.chosen },
    stipend: r.stipend.total, payback: r.payback, family_gap: r.family_gap, last: r.series[r.series.length - 1],
    centres: r.centres.map((x: any) => [x.id, x.distance_km]),
    elig: eligibility(data, c.profile).map((e: any) => [e.id, e.status, e.passed, e.total]),
    rank: rankCareers(data, c.profile).map((s: any) => [s.career.id, s.score]),
  };
});
process.stdout.write(JSON.stringify(out));
