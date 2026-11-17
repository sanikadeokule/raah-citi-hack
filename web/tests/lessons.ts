// Usage: npx tsx tests/lessons.ts data.json  -> exits non-zero if the Learn screen's lesson picking is wrong
// (run by backend/tests/test_lessons.py with the parsed spreadsheet)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forYou, lessonTopics, lessons, quiz } from "../lib/lessons";

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
