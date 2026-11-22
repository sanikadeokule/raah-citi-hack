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
  { href: "/financials/", icon: "🧮", title: { en: "Aid calculator", hi: "सहायता कैलकुलेटर", mr: "मदत कॅल्क्युलेटर" }, sub: { en: "Loan · EMI · payback", hi: "ऋण · EMI · चुकाना", mr: "कर्ज · EMI · फेड" } },

  // ── Parent dashboard

  // ── Application tracker

];

/** Text for a Pro screen in the chosen language, falling back to English. */
export function pick(text: Record<string, string>, lang: string) {
  return text[lang] ?? text.en;
}
