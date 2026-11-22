// Safe / Good chance / Reach: a rough read of how likely a student is to get into a centre.
// The dataset has no seat-wise cut-offs, so this is an estimate from the centre type's usual entry bar
// (the assumed percentile below, an assumption not a published cut-off) compared with the student's own
// class 12 percentile, then lowered one step when the centre is too far to commute and the student cannot stay in a hostel.

export type Chance = "safe" | "good" | "reach";

// Usual entry bar by centre type, as a percentile. Open-admission ITIs sit lowest; science-merit courses sit higher.
const ENTRY_BAR: { match: RegExp; bar: number }[] = [
  { match: /iti/i, bar: 35 },
  { match: /anm/i, bar: 50 },
  { match: /gnm|nurs/i, bar: 60 },
  { match: /poly/i, bar: 65 },
];
const DEFAULT_BAR = 55;
const SAFE_MARGIN = 15;

export interface ChanceResult { level: Chance; margin: number | null; farAway: boolean; needsMarks: boolean }

export function entryBar(type?: string): number {
  return ENTRY_BAR.find((e) => e.match.test(type ?? ""))?.bar ?? DEFAULT_BAR;
}

export function chanceFor(centre: { type?: string; distance_km?: number | null }, profile: any): ChanceResult {
  const pct = typeof profile?.class12_percentile === "number" ? profile.class12_percentile : null;
  const far = typeof centre.distance_km === "number" && typeof profile?.max_commute_km === "number"
    && centre.distance_km > profile.max_commute_km && !profile?.can_stay_hostel;
  if (pct === null) return { level: far ? "reach" : "good", margin: null, farAway: !!far, needsMarks: true };
  const margin = pct - entryBar(centre.type);
  let rank = margin >= SAFE_MARGIN ? 2 : margin >= 0 ? 1 : 0; // 2 safe, 1 good, 0 reach
  if (far) rank = Math.max(0, rank - 1);
  return { level: (["reach", "good", "safe"] as Chance[])[rank], margin, farAway: !!far, needsMarks: false };
}

export const CHANCE_TEXT: Record<string, Record<Chance | "no_marks" | "far", string>> = {
  en: { safe: "Safe", good: "Good chance", reach: "Reach", no_marks: "Add your class 12 percentile for a sharper estimate", far: "Far for your commute limit" },
  hi: { safe: "सुरक्षित", good: "अच्छा मौका", reach: "कठिन", no_marks: "बेहतर अनुमान के लिए 12वीं का पर्सेंटाइल जोड़ें", far: "आपकी यात्रा सीमा से दूर" },
  mr: { safe: "सुरक्षित", good: "चांगली संधी", reach: "कठीण", no_marks: "अचूक अंदाजासाठी १२वीचा पर्सेंटाइल जोडा", far: "तुमच्या प्रवास मर्यादेपेक्षा दूर" },
};
