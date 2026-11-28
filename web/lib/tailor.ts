/* eslint-disable @typescript-eslint/no-explicit-any */
// One rule for every list in the app: "your career" is the one the student saved, otherwise Raah's best match.
// Pages sort or filter by it and show a short reason; the full list always stays one tap away ("See all").
import { rankCareers } from "@/lib/engine";
import { coursesFor } from "@/lib/helpers";

export interface MyCareer { career: any; plan: any | null; saved: boolean }

export function myCareer(data: any, profile: any): MyCareer | null {
  if (!data || !profile) return null;
  const careers: any[] = data.careers ?? [];
  const pick = (c: any, saved: boolean): MyCareer => ({ career: c, saved, plan: (data.plans ?? []).find((p: any) => p.career_id === c.id) ?? null });
  const saved = careers.find((c) => c.id === profile.roadmap_career);
  if (saved) return pick(saved, true);
  if (!(profile.interests || []).length) return null;
  const best = rankCareers(data, profile, 1).find((s: any) => s.fit !== "none");
  return best ? pick(best.career, false) : null;
}

export interface Reasoned<T, R = string | null> { item: T; mine: boolean; reason: R }

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function nextExamWindow(exam: any, now = new Date()): number {
  const explicit = String(exam.dates || "");
  const dates = [...explicit.matchAll(/\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d{2})\b/gi)]
    .map((m) => Date.UTC(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])))
    .filter((stamp) => stamp >= Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  if (dates.length) return Math.min(...dates);

  const timing = String(exam.timing || "").toLowerCase();
  const months = Object.entries(MONTHS).filter(([name]) => new RegExp(`\\b${name}\\b`, "i").test(timing));
  const future = months.map(([, month]) => Date.UTC(now.getFullYear() + (month < now.getMonth() ? 1 : 0), month, 1));
  return future.length ? Math.min(...future) : Number.POSITIVE_INFINITY;
}

function fitsCurrentEligibility(exam: any, profile: any): { fits: boolean; marksKnown: boolean } {
  const cls = Number(profile?.class);
  if (!Number.isFinite(cls) || cls < 8) return { fits: false, marksKnown: false };
  const eligibility = String(exam.eligibility || "");
  const exactClass = eligibility.match(/\bClass\s+(\d+)\s+student\b/i);
  if (exactClass && cls !== Number(exactClass[1])) return { fits: false, marksKnown: false };
  const requiredClasses = [...eligibility.matchAll(/\bClass\s+(\d+)\b/gi)].map((m) => Number(m[1]));
  // an exam with several routes (Class 10 posts and Class 12 posts) is open to the lowest class
  const needClass = requiredClasses.length ? Math.min(...requiredClasses) : 0;
  if (!exactClass && requiredClasses.length && cls < needClass) return { fits: false, marksKnown: false };

  if (/\bITI certificate\b/i.test(eligibility)) {
    const hasIti = profile.iti_completed || /\bITI\b/i.test(String(profile.qualification || "")) ||
      (profile.credentials || []).some?.((x: string) => /\bITI\b/i.test(x));
    if (!hasIti) return { fits: false, marksKnown: false };
  }
  const minimumAge = eligibility.match(/\bage\s*(\d+)\s*\+/i);
  if (minimumAge && profile.age != null && Number(profile.age) < Number(minimumAge[1])) return { fits: false, marksKnown: false };

  if (exam.id === "EX06") {
    const school = String(profile.school_type || "").toLowerCase();
    if (school && !/(gov|government|aided|local|zilla|z\.p\.)/.test(school)) return { fits: false, marksKnown: false };
    const incomeLimit = eligibility.match(/income\s+up\s+to\s+[₹]?([\d,]+)/i);
    if (incomeLimit && profile.family_income_annual != null && Number(profile.family_income_annual) > Number(incomeLimit[1].replace(/,/g, ""))) {
      return { fits: false, marksKnown: false };
    }
  }

  const marks = Number(profile?.marks_pct);
  const marksExam = String(profile?.marks_exam || "").toLowerCase();
  const marksRequired = eligibility.match(/(\d+(?:\.\d+)?)%\s*(?:\((\d+(?:\.\d+)?)%\s*(?:reserved|SC\/ST)\))?/i);
  let marksKnown = false;
  if (marksRequired && Number.isFinite(marks) && marksExam !== "" && marksExam !== "unknown") {
    const requiredGradeMatch = eligibility.match(/\bClass\s+(\d+)\b/i);
    const statedGrade = eligibility.match(/\b(?:in|of)\s+Class\s+(\d+)\b/i);
    const marksGrade = Number((statedGrade || requiredGradeMatch || [])[1]);
    const expectedMarksExam = marksGrade ? `class${marksGrade}_` : "";
    if (expectedMarksExam && marksExam.startsWith(expectedMarksExam)) {
      const reserved = !["", "open", "general"].includes(String(profile.category || "").trim().toLowerCase());
      const cutoff = reserved && marksRequired[2] ? Number(marksRequired[2]) : Number(marksRequired[1]);
      marksKnown = true;
      if (marks < cutoff) return { fits: false, marksKnown };
    }
  }
  return { fits: true, marksKnown };
}

function matchesCareerPath(exam: any, mc: MyCareer | null): boolean {
  if (!mc) return false;
  if ((mc.plan?.exams || []).includes(exam.id)) return true;

  const career = mc.career;
  const careerText = `${career.name || ""} ${career.category || ""} ${(career.tags || []).join(" ")}`.toLowerCase();
  const examText = `${exam.name || ""} ${exam.leads_to || ""}`.toLowerCase();
  const degreePath = /\b(degree|b\.?sc|b\.?ca|b\.?com|b\.?tech|b\.?e\.?|bachelor|undergraduate)\b/i.test(careerText);

  // Use the stated destination, not merely the student's class, to avoid unrelated tests.
  if (/computer|programming|software|information technology|\bIT\b/i.test(careerText)) {
    if (/computer|software|information technology|\bJEE\b|\bMHT[- ]?CET\b|\bCUET(?:[- ]UG)?\b|B\.?Tech|B\.?E\.?/i.test(examText)) return true;
  }
  if (/engineer|engineering|b\.?tech|b\.?e\.?|polytechnic/i.test(careerText)) {
    if (/engineering|B\.?Tech|B\.?E\.?|\bJEE\b|\bMHT[- ]?CET\b|polytechnic|engineering diploma/i.test(examText)) return true;
  }
  if (/nurs/i.test(careerText) && /nurs|GNM/i.test(examText)) return true;
  if (/doctor|medical|medicine|MBBS|dent/i.test(careerText) && /NEET|medical|MBBS|BDS/i.test(examText)) return true;
  if (/pharm/i.test(careerText) && /pharm|MHT[- ]?CET/i.test(examText)) return true;
  if (/agricultur/i.test(careerText) && /agricultur|MHT[- ]?CET/i.test(examText)) return true;
  if (/army|defen[cs]e|navy|air force|police|constable/i.test(careerText) && /NDA|army|defen[cs]e|navy|air force|police|constable/i.test(examText)) return true;
  if (/railway/i.test(careerText) && /railway|RRC/i.test(examText)) return true;

  // A general undergraduate entrance can fit degree careers when the dataset describes it that way.
  return degreePath && /\b(CUET(?:[- ]UG)?|undergraduate admission|UG admission)\b/i.test(examText);
}

/** Current-class matches first, then the rest of the catalog. Recommended exams sort by the next known window. */
export function examsForStudent(data: any, profile: any): Reasoned<any, { key: string; vars?: Record<string, any> } | null>[] {
  const exams: any[] = data?.exams ?? [];
  const mc = myCareer(data, profile);
  const onPath = new Set<string>(mc?.plan?.exams ?? []);
  const rows = exams.map((item) => {
    const eligibility = fitsCurrentEligibility(item, profile);
    const pathMatch = onPath.has(item.id);
    // an exam the dataset lists for this career (Exams sheet "Career IDs") or for everyone, or one the wording of the career points to
    const listed = mc ? (item.career_ids ?? []).includes(mc.career.id) || (item.career_ids ?? []).includes("ALL") : false;
    const explicit = (item.career_ids ?? []).length > 0;
    // no career chosen yet: fall back to what fits the student's class and marks
    const careerMatch = !mc ? true : explicit ? listed : matchesCareerPath(item, mc);
    return {
      item, mine: eligibility.fits && careerMatch,
      reason: eligibility.fits && careerMatch
        ? (mc ? { key: "because_career", vars: { career: mc.career.name } }
          : { key: eligibility.marksKnown ? "because_class_marks" : "because_class", vars: { class: profile.class } })
        : null,
      nextWindow: nextExamWindow(item),
    };
  });
  const recommended = rows.filter((r) => r.mine).sort((a, b) => a.nextWindow - b.nextWindow);
  return [...recommended, ...rows.filter((r) => !r.mine)];
}

/** Free courses: the ones that fit the student's career first. */
export function coursesForStudent(data: any, profile: any): Reasoned<any>[] {
  const courses: any[] = data?.courses ?? [];
  const mc = myCareer(data, profile);
  const ids = new Set<string>(mc ? coursesFor(data, mc.career, mc.plan).map((c: any) => c.id) : []);
  const rows = courses.map((item) => ({ item, mine: ids.has(item.id), reason: ids.has(item.id) && mc ? mc.career.name : null }));
  return [...rows.filter((r) => r.mine), ...rows.filter((r) => !r.mine)];
}
