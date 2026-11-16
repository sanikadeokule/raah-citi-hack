/* eslint-disable @typescript-eslint/no-explicit-any */
// The Discover questions, written for students who may be using a phone for the first time.
// Each question says exactly what we need, gives an example answer, and offers tap-to-answer chips.
// The wording lives in locales/{en,mr,hi}.json under q_* keys so all three languages stay in step.

export type T = (k: string, vars?: Record<string, string | number>) => string;
/** patch: extra fields to store when this chip is tapped */
export type Opt = { v: any; label: string; icon?: string; patch?: Record<string, any> };
/** ok: value for the question's field, plus any extra fields to store. error: a message key and its variables. */
export type Parsed = { ok: true; value: any; extra?: Record<string, any> } | { ok: false; error: string; vars?: Record<string, string | number> };

export type Q = {
  key: string;
  kind: "text" | "number" | "choice" | "multi";
  /** question and example hint, already in the student's language */
  ask: (t: T, p: any) => { text: string; hint: string };
  options?: (d: any, t: T, p: any) => Opt[];
  /** turn a typed or spoken answer into a value, or explain what is wrong with it */
  parse?: (raw: string) => Parsed;
  /** choice question that also takes a typed answer that is not one of the chips */
  free?: boolean;
  /** true when the profile already answers this question */
  answered?: (p: any) => boolean;
};

const isMissing = (v: any) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Devanagari digits (०-९) to ASCII so "४१२/५००" reads like "412/500". */
export const asciiDigits = (s: string) => s.replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x0966));

const numbers = (s: string) => (asciiDigits(s).replace(/(\d),(\d)/g, "$1$2").match(/\d+(?:\.\d+)?/g) || []).map(Number);

export function parseAge(raw: string): Parsed {
  const n = numbers(raw)[0];
  if (n === undefined) return { ok: false, error: "q_age_err" };
  if (n < 10 || n > 30) return { ok: false, error: "q_age_err" };
  return { ok: true, value: Math.round(n) };
}

/** Full-year exams a student may have results for, oldest first. `grade` is the class the exam ends. */
export const EXAMS = [
  { id: "class7_final", grade: 7 },
  { id: "class8_final", grade: 8 },
  { id: "class9_final", grade: 9 },
  { id: "class10_board", grade: 10 },
  { id: "class11_final", grade: 11 },
  { id: "class12_board", grade: 12 },
] as const;

/** The two most recent full-year exams before the student's current class, newest first.
 *  A Class 10 student sees "Class 9 final" and "Class 8 final"; a Class 12 student sees "Class 11 final" and "Class 10 board". */
export function examsFor(cls: number | undefined) {
  const c = Number(cls) || 10;
  const done = EXAMS.filter((e) => e.grade < c).reverse();
  // a Class 12 student's 10th board result is the one most forms ask for, so always offer it
  const pick = done.slice(0, 2);
  const board10 = EXAMS.find((e) => e.id === "class10_board")!;
  if (c >= 12 && !pick.includes(board10)) pick.push(board10);
  return pick.length ? pick : [EXAMS[0]];
}

/**
 * Marks typed or spoken as "412/500", "412 out of 500", "500 पैकी 412", "500 में से 412" or "82%".
 * The smaller number is always the marks obtained, so word order in Marathi and Hindi does not matter.
 * A total under 100 is a unit test or class test, not a full-year result, so it is refused with a clear reason.
 */
export function parseMarks(raw: string): Parsed {
  const s = asciiDigits(raw).toLowerCase();
  const ns = numbers(s);
  const saysPct = /%|percent|per cent|टक्के|टक्का|प्रतिशत|पर्सेंट|परसेंट/.test(s);
  if (!ns.length) return { ok: false, error: "q_marks_err_unclear" };
  if (ns.length === 1 || saysPct) {
    const n = ns[0];
    if (!saysPct) return { ok: false, error: "q_marks_err_need_total", vars: { n } };
    if (n < 0 || n > 100) return { ok: false, error: "q_marks_err_pct" };
    return { ok: true, value: Math.round(n * 10) / 10 };
  }
  const got = Math.min(ns[0], ns[1]);
  const total = Math.max(ns[0], ns[1]);
  if (total < 100) return { ok: false, error: "q_marks_err_small_total", vars: { total } };
  if (total > 1500) return { ok: false, error: "q_marks_err_unclear" };
  return { ok: true, value: Math.round((got / total) * 1000) / 10, extra: { marks_obtained: got, marks_total: total } };
}

/** Usual age range for a class in Maharashtra: Class 1 at about 6, so Class N at N+5 to N+6.
 *  We allow 1 year below and 1 year above that (repeating a year, starting late). */
export const USUAL_AGE_GAP = [5, 6] as const;
export const AGE_BUFFER = 1;
export function usualAge(cls: number) {
  return { min: cls + USUAL_AGE_GAP[0], max: cls + USUAL_AGE_GAP[1] };
}
/** true when age and class fit together (or one is not known yet) */
export function ageFitsClass(age: any, cls: any) {
  const a = Number(age), c = Number(cls);
  if (!a || !c) return true;
  const u = usualAge(c);
  return a >= u.min - AGE_BUFFER && a <= u.max + AGE_BUFFER;
}

const INCOME: [number, string][] = [[100000, "inc_lt1"], [180000, "inc_1_2"], [240000, "inc_2_25"], [320000, "inc_25_35"],
  [450000, "inc_35_45"], [700000, "inc_45_8"], [900000, "inc_gt8"]];
const DOCS = ["aadhaar", "marksheet_10", "caste_certificate", "income_certificate", "domicile_certificate", "bank_passbook"];
const CATEGORIES = ["General", "EWS", "OBC", "SC", "ST", "DNT", "EBC", "SEBC", "VJNT", "SBC", "Navbouddha"];

const ask = (key: string, vars?: (p: any, t: T) => Record<string, string | number>) => (t: T, p: any) => {
  const v = vars ? vars(p, t) : undefined;
  return { text: t(`q_${key}`, v), hint: t(`q_${key}_hint`, v) };
};

export const QUESTIONS: Q[] = [
  { key: "name", kind: "text", ask: ask("name") },
  { key: "age", kind: "number", ask: ask("age"), parse: parseAge },
  { key: "gender", kind: "choice", ask: ask("gender"),
    options: (_d, t) => [{ v: "F", label: t("opt_girl"), icon: "👧" }, { v: "M", label: t("opt_boy"), icon: "👦" }] },
  { key: "class", kind: "choice", ask: ask("class"),
    options: (_d, t) => [8, 9, 10, 11, 12].map((c) => ({ v: c, label: t("opt_class", { n: c }) })) },
  // only asked when the age and class do not fit together: a 16-year-old in Class 8 is asked to check
  { key: "age_class_ok", kind: "choice",
    ask: ask("age_check", (p) => ({ age: p.age, class: p.class, min: usualAge(p.class).min, max: usualAge(p.class).max })),
    answered: (p) => p.age_class_ok === true || ageFitsClass(p.age, p.class),
    options: (_d, t) => [
      { v: true, label: t("opt_age_class_right"), icon: "✅" },
      { v: undefined, label: t("opt_fix_age"), icon: "✏️", patch: { age: undefined } },
      { v: undefined, label: t("opt_fix_class"), icon: "✏️", patch: { class: undefined } },
    ] },
  { key: "interests", kind: "multi", ask: ask("interests"),
    options: (d) => {
      const count: Record<string, number> = {};
      d.careers.forEach((c: any) => c.tags.forEach((x: string) => (count[x] = (count[x] || 0) + 1)));
      return Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([x]) => ({ v: x, label: x }));
    } },
  { key: "marks_exam", kind: "choice", ask: ask("marks_exam"),
    options: (_d, t, p) => [...examsFor(p.class).map((e) => ({ v: e.id, label: t(`exam_${e.id}`), icon: "📄" })),
      { v: "unknown", label: t("opt_dont_remember"), icon: "🤷" }] },
  { key: "marks_pct", kind: "text", ask: ask("marks", (p, t) => ({ exam: t(`exam_${p.marks_exam}`) })), parse: parseMarks,
    answered: (p) => !isMissing(p.marks_pct) || p.marks_exam === "unknown",
    options: (_d, t) => [{ v: null, label: t("opt_dont_remember"), icon: "🤷", patch: { marks_exam: "unknown" } }] },
  { key: "taluka", kind: "choice", free: true, ask: ask("taluka"),
    options: (d) => d.talukas.filter((x: any) => x.name !== "Pune city").map((x: any) => ({ v: x.name, label: x.name })) },
  { key: "category", kind: "choice", ask: ask("category"),
    options: (_d, t) => CATEGORIES.map((c) => ({ v: c, label: c === "General" ? t("opt_general") : c })) },
  { key: "family_income_annual", kind: "choice", ask: ask("income"),
    options: (_d, t) => INCOME.map(([v, k]) => ({ v, label: t(k) })) },
  { key: "max_commute_km", kind: "choice", ask: ask("commute"),
    options: (_d, t) => [5, 10, 20, 35, 50].map((k) => ({ v: k, label: t("opt_km", { n: k }), icon: "🚌" })) },
  { key: "can_stay_hostel", kind: "choice", ask: ask("hostel"),
    options: (_d, t) => [{ v: true, label: t("opt_yes"), icon: "🏠" }, { v: false, label: t("opt_no"), icon: "🚫" }] },
  { key: "documents", kind: "multi", ask: ask("documents"),
    answered: (p) => Array.isArray(p.documents) && (p.documents.length > 0 || p.documents_none === true),
    options: (_d, t) => DOCS.map((x) => ({ v: x, label: t(`doc_${x}`) })) },
];

export const answered = (q: Q, p: any) => (q.answered ? q.answered(p) : !isMissing(p[q.key]));

/** Index of the first unanswered question at or after `from`; QUESTIONS.length when all are answered. */
export function firstMissing(p: any, from = 0) {
  const i = QUESTIONS.findIndex((q, k) => k >= from && !answered(q, p));
  return i === -1 ? QUESTIONS.length : i;
}

/** A typed place name, tidied: "  junnar " -> "Junnar". Empty or too long (not a name) gives null. */
export function cleanPlace(raw: string): string | null {
  const v = raw.trim().replace(/\s+/g, " ").replace(/[.,!?]+$/, "");
  if (!v || v.length > 40 || /\d/.test(v)) return null;
  return v.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
