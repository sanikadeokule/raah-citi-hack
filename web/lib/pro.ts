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

  // ── Application tracker
  { href: "/tracker/", icon: "📋", title: { en: "App tracker", hi: "आवेदन ट्रैकर", mr: "अर्ज ट्रॅकर" }, sub: { en: "College · scholarship board", hi: "कॉलेज · छात्रवृत्ति", mr: "कॉलेज · शिष्यवृत्ती" } },

];

/** Text for a Pro screen in the chosen language, falling back to English. */
export function pick(text: Record<string, string>, lang: string) {
  return text[lang] ?? text.en;
}
