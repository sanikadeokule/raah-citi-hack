// Raah Pro features, shown together on the home screen once each one is built.
// Each feature adds its own entry under its comment (kept apart so the features can be merged in any order).

export interface ProFeature {
  href: string;
  icon: string;
  titleKey: string;
  subKey: string;
}

export const PRO_FEATURES: ProFeature[] = [
  // ── Financial aid calculator
  { href: "/financials/", icon: "scales", titleKey: "pro_feature_fin_title", subKey: "pro_feature_fin_sub" },

  // ── Parent dashboard
  { href: "/parent/", icon: "family", titleKey: "pro_feature_parent_title", subKey: "pro_feature_parent_sub" },

  // ── Application tracker
  { href: "/tracker/", icon: "clipboard", titleKey: "pro_feature_tracker_title", subKey: "pro_feature_tracker_sub" },

];
