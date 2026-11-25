// Usage: npx tsx tests/ikigai.ts data.json  -> exits non-zero if the Discover sweet-spot logic is wrong
// (run by backend/tests/test_ikigai.py with the parsed spreadsheet)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allTagsOf, extractTags, reachable, sweetSpots } from "../lib/ikigai";

const d = JSON.parse(readFileSync(process.argv[2], "utf8"));
const tags = allTagsOf(d);
assert.ok(tags.length > 20 && tags.includes("helping people"));

// typed and spoken answers become the dataset's own tags, in any of the three languages
assert.deepEqual(extractTags("I like helping people and fixing phones", tags).sort(), ["fixing things", "helping people", "phones"].sort());
assert.ok(extractTags("मला प्राण्यांची आवड आहे", tags).includes("animals"), "Marathi tag name");
assert.ok(extractTags("मुझे कंप्यूटर पसंद है", tags).includes("computers"), "Hindi tag name");
assert.deepEqual(extractTags("   ", tags), []);
assert.deepEqual(extractTags("zzz qqq", tags), []);

const profile = { class: 10, marks_pct: 68, category: "OBC", family_income_annual: 180000, taluka: "Haveli", gender: "F", interests: [] };
const spots = sweetSpots(d, profile, ["helping people", "health"], ["talking to people"]);
assert.ok(spots.length > 0, "something matches");
assert.ok(spots.every((s, i) => i === 0 || spots[i - 1].score >= s.score), "best overlap first");
for (const s of spots) {
  for (const c of ["love", "good", "pays", "needed"] as const) assert.ok(["yes", "part", "no", "unknown"].includes(s.checks[c].level));
  assert.ok(s.checks.love.level !== "no" || s.checks.good.level !== "no", "never a career that matches nothing said");
}
// someone who says nothing gets no sweet spots instead of a made-up match
assert.equal(sweetSpots(d, profile, [], []).length, 0);

const withPlan = spots.find((s) => s.plan)!;
const r = reachable(d, profile, withPlan)!;
assert.ok(r.total > 0 && r.perMonth >= 0 && Array.isArray(r.steps) && r.steps.length > 0);
console.log("ikigai ok");
