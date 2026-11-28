// Reading and listening settings: text size, high contrast, and read-aloud. Saved to localStorage and applied as
// attributes on <html> (see app/globals.css), the same mechanism components/profilemenu.tsx uses for the theme —
// so a change here reaches every page, not just the settings screen itself.
export type TextSize = "normal" | "large" | "xlarge";
export type Contrast = "normal" | "high";

const TEXTSIZE_KEY = "raah-textsize";
const CONTRAST_KEY = "raah-contrast";
const READALOUD_KEY = "raah-readaloud";

export function readTextSize(): TextSize {
  try {
    const v = localStorage.getItem(TEXTSIZE_KEY);
    return v === "large" || v === "xlarge" ? v : "normal";
  } catch { return "normal"; }
}
export function applyTextSize(v: TextSize) {
  const root = document.documentElement;
  if (v === "normal") root.removeAttribute("data-textsize"); else root.setAttribute("data-textsize", v);
}
export function setTextSize(v: TextSize) {
  applyTextSize(v);
  try { if (v === "normal") localStorage.removeItem(TEXTSIZE_KEY); else localStorage.setItem(TEXTSIZE_KEY, v); } catch { /* still applied for this visit */ }
}

export function readContrast(): Contrast {
  try { return localStorage.getItem(CONTRAST_KEY) === "high" ? "high" : "normal"; } catch { return "normal"; }
}
export function applyContrast(v: Contrast) {
  const root = document.documentElement;
  if (v === "high") root.setAttribute("data-contrast", "high"); else root.removeAttribute("data-contrast");
}
export function setContrast(v: Contrast) {
  applyContrast(v);
  try { if (v === "high") localStorage.setItem(CONTRAST_KEY, "high"); else localStorage.removeItem(CONTRAST_KEY); } catch { /* still applied for this visit */ }
}

export function readReadAloud(): boolean {
  try { return localStorage.getItem(READALOUD_KEY) === "1"; } catch { return false; }
}
export function setReadAloud(v: boolean) {
  try { if (v) localStorage.setItem(READALOUD_KEY, "1"); else localStorage.removeItem(READALOUD_KEY); } catch { /* lost on reload, not fatal */ }
}

/** Run once, as early as possible on every page (lib/store.tsx's Provider), so size/contrast never flash to default first. */
export function applySavedA11y() {
  applyTextSize(readTextSize());
  applyContrast(readContrast());
}
