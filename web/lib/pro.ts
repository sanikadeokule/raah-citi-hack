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
  { href: "/financials/", icon: "🧮", title: { en: "Financial aid calculator", hi: "आर्थिक मदद कैलकुलेटर", mr: "आर्थिक मदत कॅल्क्युलेटर" }, sub: { en: "Loan · EMI · payback", hi: "ऋण · EMI · चुकाना", mr: "कर्ज · EMI · फेड" } },

  // ── Parent dashboard
  { href: "/parent/", icon: "👨‍👩‍👧", title: { en: "Parent view", hi: "परिवार दृश्य", mr: "कुटुंब दृश्य" }, sub: { en: "Roadmap · exams · lessons", hi: "रोडमैप · परीक्षा · पाठ", mr: "रोडमॅप · परीक्षा · धडे" } },

  // ── Application tracker
  { href: "/tracker/", icon: "📋", title: { en: "App tracker", hi: "आवेदन ट्रैकर", mr: "अर्ज ट्रॅकर" }, sub: { en: "College · scholarship board", hi: "कॉलेज · छात्रवृत्ति", mr: "कॉलेज · शिष्यवृत्ती" } },

];

/** Text for a Pro screen in the chosen language, falling back to English. */
export function pick(text: Record<string, string>, lang: string) {
  return text[lang] ?? text.en;
}
