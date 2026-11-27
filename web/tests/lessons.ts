// Usage: npx tsx tests/lessons.ts data.json  -> exits non-zero if the Learn screen's lesson picking is wrong
// (run by backend/tests/test_lessons.py with the parsed spreadsheet)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forYou, forYouRanked, lessonTopics, lessons, quiz } from "../lib/lessons";
import { rankFor, studentGaps } from "../lib/gaps";

const d = JSON.parse(readFileSync(process.argv[2], "utf8"));
const en = lessons(d, "en");
const ids = (ls: any[]) => ls.map((l) => l.id);

// every topic in the dropdown has lessons, basics first with the three built-in lessons
const topics = lessonTopics(d, "en", en);
assert.equal(topics[0].id, "basics");
for (const t of topics) assert.ok(en.some((l) => l.topic === t.id), t.id);
assert.deepEqual(ids(en.filter((l) => l.topic === "basics")).slice(0, 3), ["L1", "L2", "L3"]);

// quiz: at most five, the marked answer is one of the options, and no money figures
for (const t of topics) {
  const qs = quiz(en.filter((l) => l.topic === t.id));
  assert.ok(qs.length >= 1 && qs.length <= 5, t.id);
  for (const q of qs) {
    assert.ok(q.answer >= 0 && q.answer < q.options.length);
    assert.ok(!/₹/.test(q.q + q.options.join(" ")), q.q);
  }
}
const l1 = en.find((l) => l.id === "L1")!;
assert.equal(l1.quiz!.options[l1.quiz!.answer], "Class 10");

// "For you" follows the student's interests
const base = d.students[0];
const machines = forYou(d, { ...base, interests: ["machines", "fixing things", "electrical"] }, en);
assert.ok(ids(machines).includes("CAR01"), "electrician lesson for a student who likes electrical work");
const comp = forYou(d, { ...base, class: 12, interests: ["computers"] }, en);
assert.ok(ids(comp).includes("G02"), "'What is a computer?' for a student who likes computers");
assert.ok(ids(comp).includes("CAR10") || ids(comp).includes("CAR20"), JSON.stringify(ids(comp)));
assert.deepEqual(forYou(d, { ...base, interests: [] }, en), []);

// language: Hindi and Marathi titles, not English
const mr = lessons(d, "mr");
assert.ok(/[ऀ-ॿ]/.test(mr.find((l) => l.id === "CAR10")!.title));
assert.ok(/[ऀ-ॿ]/.test(lessons(d, "hi").find((l) => l.id === "G01")!.quiz!.q));
assert.ok(/[ऀ-ॿ]/.test(lessonTopics(d, "mr", mr)[1].name));
console.log("ok", en.length, "lessons");

// courses and lessons for a student's gaps (lib/gaps.ts): career first, then gaps, then what she enjoys, each with a reason
{
  const stu = { ...base, interests: ["electrical"], roadmap_career: "CAR36", ikigai: { good_at: ["hands-on"] } };
  const g = studentGaps(d, stu);
  assert.equal(g.careerId, "CAR36");
  assert.ok(!g.gap.includes("hands-on") || !(d.careers.find((c: any) => c.id === "CAR36").tags.includes("hands-on")), "what she is good at is not a gap");
  const picks = rankFor<any>(d.courses, g);
  assert.ok(picks.length > 0 && picks.every((p) => p.reason.kind), "every pick has a reason");
  assert.ok(["CRS02", "CRS26"].includes(picks[0].item.id), `solar course first for a solar career: ${picks[0].item.id}`);
  assert.equal(picks[0].reason.kind, "first");
  // a course that serves no career of hers but builds a gap skill comes next
  assert.ok(picks.some((p) => p.reason.kind === "gap"), "a gap course shows up");
  // a finished lesson goes after unfinished ones of the same fit
  const ranked = forYouRanked(d, stu, en);
  const kind0 = ranked[0].reason.kind;
  const same = ranked.filter((x) => x.reason.kind === kind0 && x.score >= ranked[0].score - 0.01);
  if (same.length > 1) {
    const after = forYouRanked(d, stu, en, [ranked[0].item.id]);
    assert.ok(after.findIndex((x) => x.item.id === ranked[0].item.id) > 0, "a finished lesson moves down");
  }
  // no career and no interests: nothing is picked for her
  assert.equal(rankFor<any>(d.courses, studentGaps(d, { ...base, interests: [] })).length, 0);
}
