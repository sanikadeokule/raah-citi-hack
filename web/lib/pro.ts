// Raah Pro features, shown together on the home screen once each one is built.
// Each feature adds its own entry under its comment (kept apart so the features can be merged in any order).

export interface ProFeature {
  href: string;
  icon: string;
  title: Record<string, string>; // by language code: en, hi, mr
  sub: Record<string, string>;
}

export const PRO_FEATURES: ProFeature[] = [
  // ── Financial aid calculator

  // ── Parent dashboard
  { href: "/parent/", icon: "👨‍👩‍👧", title: { en: "Parent view", hi: "परिवार दृश्य", mr: "कुटुंब दृश्य" }, sub: { en: "Roadmap · exams · lessons", hi: "रोडमैप · परीक्षा · पाठ", mr: "रोडमॅप · परीक्षा · धडे" } },

  // ── Application tracker

];

/** Text for a Pro screen in the chosen language, falling back to English. */
export function pick(text: Record<string, string>, lang: string) {
  return text[lang] ?? text.en;
}
