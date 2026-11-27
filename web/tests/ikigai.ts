// Usage: npx tsx tests/ikigai.ts data.json  -> exits non-zero if the Discover sweet-spot logic is wrong
// (run by backend/tests/test_ikigai.py with the parsed spreadsheet)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rankCareers } from "../lib/engine";
import { allTagsOf, extractTags, reachable, refiners, sweetSpots } from "../lib/ikigai";
import { SELECTABLE_LANGUAGES } from "../lib/languages";

const d = JSON.parse(readFileSync(process.argv[2], "utf8"));
const tags = allTagsOf(d);
assert.ok(tags.length > 20 && tags.includes("helping people"));

// typed and spoken answers become the dataset's own tags, in any of the three languages
assert.deepEqual(extractTags("I like helping people and fixing phones", tags).sort(), ["fixing things", "helping people", "phones"].sort());
assert.ok(extractTags("मला प्राण्यांची आवड आहे", tags).includes("animals"), "Marathi tag name");
assert.ok(extractTags("मुझे कंप्यूटर पसंद है", tags).includes("computers"), "Hindi tag name");
assert.deepEqual(extractTags("   ", tags), []);
assert.deepEqual(extractTags("zzz qqq", tags), []);

// finer tags: what you do and how you work are in the dataset, and everyday words reach them
for (const t of ["patient care", "protecting people", "using tools", "problem solving", "customer service"]) assert.ok(tags.includes(t), `${t} is a tag`);
for (const { code } of SELECTABLE_LANGUAGES) {
  const labels = JSON.parse(readFileSync(`locales/${code}.json`, "utf8"));
  assert.ok(extractTags(labels["interest_patient care"], tags).includes("patient care"), `${code}: localized interest tag`);
}
assert.ok(extractTags("I like looking after patients in the hospital", tags).includes("patient care"));
assert.ok(extractTags("fixing things with tools", tags).includes("using tools"));
assert.ok((d.careers as any[]).filter((c) => c.tags.includes("helping people")).length <= 3, "helping people is not shared with every caring job");
assert.ok((d.careers as any[]).every((c) => c.tags.length >= 5), "every career has enough tags to tell it apart");
// the follow-up question offers what sits beside what the student named, never what they already said
const near = refiners(d, ["health"], ["biology"]);
assert.equal(near.length, 3);
assert.ok(!near.includes("health") && !near.includes("biology") && new Set(near).size === 3);
assert.deepEqual(refiners(d, ["zzz"], []), []);

const profile = { class: 10, marks_pct: 68, category: "OBC", family_income_annual: 180000, taluka: "Haveli", gender: "F", interests: [] };
const spots = sweetSpots(d, profile, ["helping people", "health"], ["talking to people"]);
assert.ok(spots.length > 0, "something matches");
assert.ok(spots.every((s, i) => i === 0 || spots[i - 1].pct >= s.pct), "best match percentage first");
assert.ok(spots.every((s) => s.pct >= 0 && s.pct <= 100), "percentages are 0 to 100");
// pays counts double: with equal love and good at, a career that pays more never ranks below one that pays less
console.log("top 5:", spots.slice(0, 5).map((s) => `${s.career.name} ${s.pct}%`).join(" | "));
for (const s of spots) {
  for (const c of ["love", "good", "pays", "needed"] as const) assert.ok(["yes", "part", "no", "unknown"].includes(s.checks[c].level));
  assert.ok(s.checks.love.level !== "no" || s.checks.good.level !== "no", "never a career that matches nothing said");
}
// meaning match: 30% keywords + 70% meaning. A career the keywords miss still shows up when the meaning is close
const kw = sweetSpots(d, profile, ["helping people"], []);
const target = d.careers.find((c: any) => !kw.some((x: any) => x.career.id === c.id))!;
const sem = sweetSpots(d, profile, ["helping people"], [], { love: { [target.id]: 1 } });
const found = sem.find((x: any) => x.career.id === target.id);
assert.ok(found && found.parts.love > 0.6 && found.parts.love <= 0.7 + 1e-9, "meaning alone counts for 70%");
const both = sweetSpots(d, profile, ["helping people"], [], { love: Object.fromEntries(d.careers.map((c: any) => [c.id, 0])) });
const top = kw[0].career.id;
assert.ok(both.find((x: any) => x.career.id === top)!.parts.love <= kw[0].parts.love * 0.3 + 1e-9, "keywords alone count for 30% when the meaning says no");
assert.deepEqual(sweetSpots(d, profile, ["helping people"], [], {}).map((x: any) => x.pct), kw.map((x: any) => x.pct), "no model: keywords only, nothing changes");
// someone who says nothing gets no sweet spots instead of a made-up match
assert.equal(sweetSpots(d, profile, [], []).length, 0);

const withPlan = spots.find((s) => s.plan)!;
const r = reachable(d, profile, withPlan)!;
assert.ok(r.total > 0 && r.perMonth >= 0 && Array.isArray(r.steps) && r.steps.length > 0);
console.log("ikigai ok");

// free text: the student's own words map to tags where they can ("logical things, medicine, house hold work")
{
  const tg = allTagsOf(JSON.parse(require("fs").readFileSync(process.argv[2], "utf8")));
  const got = extractTags("logical things, medicine, house hold work", tg);
  for (const w of ["maths", "health", "organising"]) if (!got.includes(w)) { console.error("FAIL free text missing", w, got); process.exit(1); }
  console.log("ok free text", got.join(","));
}

// the top 5 uses the same blend once Discover has saved the meaning scores (same numbers as the Python engine)
{
  const base = { class: 10, marks_pct: 60, family_income_annual: 180000, interests: ["helping people"] } as any;
  const plain = new Map<string, any>(rankCareers(d, base, d.careers.length).map((x: any) => [x.career.id, x]));
  const other = d.careers.find((c: any) => plain.get(c.id).fit === "none").id;
  const scores = Object.fromEntries(d.careers.map((c: any) => [c.id, 0]));
  scores[other] = 1;
  const blended = new Map<string, any>(rankCareers(d, { ...base, interest_meaning: { for: ["helping people"], scores } }, d.careers.length).map((x: any) => [x.career.id, x]));
  assert.equal(blended.get(other).fit, "related");
  assert.equal(blended.get(other).breakdown.interest, 0.7);
  assert.ok(blended.get(other).why.includes("close in meaning"));
  const stale = rankCareers(d, { ...base, interests: ["machines"], interest_meaning: { for: ["helping people"], scores } }, 5).map((x: any) => x.career.id);
  assert.deepEqual(stale, rankCareers(d, { ...base, interests: ["machines"] }, 5).map((x: any) => x.career.id));
}
