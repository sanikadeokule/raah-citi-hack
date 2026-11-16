// Usage: npx tsx tests/questions.ts  -> exits non-zero if a Discover answer check is wrong (also run by backend/tests/test_questions.py)
import assert from "node:assert/strict";
import { examsFor, firstMissing, parseAge, parseMarks, QUESTIONS } from "../lib/questions";

const ok = (r: any) => (assert.ok(r.ok, JSON.stringify(r)), r);
const err = (r: any, e: string) => (assert.ok(!r.ok && r.error === e, JSON.stringify(r)), r);

assert.equal(ok(parseMarks("412/500")).value, 82.4);
assert.deepEqual(ok(parseMarks("412 out of 500")).extra, { marks_obtained: 412, marks_total: 500 });
assert.equal(ok(parseMarks("500 पैकी 412")).value, 82.4); // Marathi word order
assert.equal(ok(parseMarks("५०० में से ४१२")).value, 82.4); // Hindi with Devanagari digits
assert.equal(ok(parseMarks("82%")).value, 82);
assert.equal(ok(parseMarks("78 टक्के")).value, 78);
err(parseMarks("25/25"), "q_marks_err_small_total"); // unit test
err(parseMarks("18 out of 20"), "q_marks_err_small_total");
err(parseMarks("82"), "q_marks_err_need_total");
err(parseMarks("120%"), "q_marks_err_pct");
err(parseMarks("I don't know"), "q_marks_err_unclear");

assert.equal(ok(parseAge("मी १५ वर्षांची आहे")).value, 15);
err(parseAge("150"), "q_age_err");

assert.deepEqual(examsFor(10).map((e) => e.id), ["class9_final", "class8_final"]);
assert.deepEqual(examsFor(11).map((e) => e.id), ["class10_board", "class9_final"]);
assert.deepEqual(examsFor(12).map((e) => e.id), ["class11_final", "class10_board"]);

const at = (k: string) => QUESTIONS.findIndex((q) => q.key === k);
assert.equal(firstMissing({ name: "Sanika" }), at("age")); // registered name is not asked again
assert.equal(firstMissing({ name: "S", age: 15, gender: "F", class: 10, interests: ["x"], marks_exam: "unknown" }), at("taluka"));
const all = { name: "S", age: 15, gender: "F", class: 10, interests: ["x"], marks_exam: "class9_final", marks_pct: 80, taluka: "Junnar",
  category: "OBC", family_income_annual: 100000, max_commute_km: 10, can_stay_hostel: false, documents: [], documents_none: true };
assert.equal(firstMissing(all), QUESTIONS.length);

// every question and chip has wording in all three languages
for (const lang of ["en", "mr", "hi"]) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const L = require(`../locales/${lang}.json`);
  const t = (k: string) => { assert.ok(k in L, `${lang} is missing ${k}`); return L[k]; };
  const d = { careers: [{ tags: ["farming"] }], talukas: [{ name: "Junnar" }] };
  for (const q of QUESTIONS) {
    q.ask(t, { marks_exam: "class9_final" });
    q.options?.(d, t, { class: 12 });
  }
}
console.log("questions ok");
