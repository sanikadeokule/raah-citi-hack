// Usage: npx tsx tests/listings.ts <data.json>  -> exits non-zero if the Apprenticeships career filter is wrong
// (run by backend/tests/test_listings.py with the live spreadsheet)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countsByCareer, mentorMatches, pickForCareers, tradeMatches, tradeMatchesCareer } from "../lib/listings";

// trade names as NAPS / railway list them vs career names
assert.ok(tradeMatchesCareer("Machinist", "Machinist / Turner"));
assert.ok(tradeMatchesCareer("Warehouse Supervisor V3", "Warehouse Supervisor"));
assert.ok(tradeMatchesCareer("Mechanic Refrigeration and Air Conditioning", "AC & Refrigeration Mechanic"));
assert.ok(tradeMatchesCareer("Recruitment Executive", "Recruitment / HR Executive"));
assert.ok(tradeMatchesCareer("Assistant Operator - Printing and Packaging", "Printing & Packaging Operator"));
assert.ok(!tradeMatchesCareer("Mechanic Refrigeration and Air Conditioning", "Mechanic (Diesel)"));
assert.ok(!tradeMatchesCareer("Automotive Assembly Operator", "Automotive Assembly Technician"));
assert.ok(!tradeMatchesCareer("Production Engineer", "Pharma Production Machine Operator"));

// small made-up dataset: the dropdown must change every list, and fall back to related careers
const mini = {
  careers: [
    { id: "C1", name: "Electrician", tags: ["electrical", "hands-on", "machines"] },
    { id: "C2", name: "Fitter", tags: ["machines", "hands-on"] },
    { id: "C3", name: "Railway Act Apprentice (any ITI trade)", tags: ["machines", "hands-on", "government job"] },
    { id: "C4", name: "Dairy farming", tags: ["animals"] },
  ],
  mentors: [{ id: "M1", career_ids: ["C1"] }],
  naps: [{ id: "N1", trade: "Electrician" }, { id: "N2", trade: "Fitter" }],
  railway: [{ id: "R1", trade: "Fitter" }],
};
const ids = (p: { items: any[] }) => p.items.map((x) => x.id);
assert.deepEqual(ids(pickForCareers(mini, mini.naps, "C1", [], tradeMatches)), ["N1"]);
assert.deepEqual(ids(pickForCareers(mini, mini.naps, "C2", [], tradeMatches)), ["N2"]);
assert.deepEqual(ids(pickForCareers(mini, mini.railway, "C1", [], tradeMatches)).length, 1); // related: Fitter
assert.deepEqual(pickForCareers(mini, mini.railway, "C1", [], tradeMatches).related?.map((c) => c.id), ["C2"]);
assert.equal(pickForCareers(mini, mini.railway, "C2", [], tradeMatches).related, null);
assert.deepEqual(ids(pickForCareers(mini, mini.naps, "top", ["C1", "C2"], tradeMatches)), ["N1", "N2"]);
assert.deepEqual(ids(pickForCareers(mini, mini.naps, "all", [], tradeMatches)), ["N1", "N2"]);
const none = pickForCareers(mini, mini.naps, "C4", [], tradeMatches); // nothing shares 2 tags: honest empty list
assert.deepEqual(none, { items: [], related: null });
assert.deepEqual(ids(pickForCareers(mini, mini.mentors, "C2", [], mentorMatches)), ["M1"]); // related mentor
assert.deepEqual(countsByCareer(mini), { C1: 2, C2: 2, C3: 0, C4: 0 });

// the live spreadsheet: a career's own trade rows show up when it is picked
if (process.argv[2]) {
  const data = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const byName = (n: string) => data.careers.find((c: any) => c.name === n);
  for (const [career, sheet, trade] of [["Electrician", "naps", "Electrician"], ["Fitter", "railway", "Fitter"],
    ["Welder", "railway", "Welder"], ["CNC Operator", "naps", "CNC Programmer cum Operator"]]) {
    const c = byName(career);
    if (!c || !data[sheet].some((n: any) => n.trade === trade)) continue; // row removed from the sheet
    const got = pickForCareers(data, data[sheet], c.id, [], tradeMatches);
    assert.equal(got.related, null, career);
    assert.ok(got.items.length && got.items.every((n: any) => tradeMatches(n, c)), career);
  }
  // picking different careers gives different lists (the old page showed the same 31 rows for all)
  const lists = new Set(data.careers.map((c: any) => ids(pickForCareers(data, data.naps, c.id, [], tradeMatches)).join(",")));
  assert.ok(lists.size > 10, `only ${lists.size} distinct NAPS lists`);
}
console.log("listings ok");
