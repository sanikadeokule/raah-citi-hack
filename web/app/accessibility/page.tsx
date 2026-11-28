"use client";
// Reading and listening settings (wireframe "I1"): text size and high contrast apply to the whole app at once,
// via the data-textsize/data-contrast attributes in app/globals.css (lib/a11y.ts), the same mechanism the
// Appearance theme toggle uses. Linked from components/profilemenu.tsx.
import { useEffect, useState } from "react";
import { Card, Shell } from "@/components/ui";
import { useApp } from "@/lib/store";
import { readContrast, readReadAloud, readTextSize, setContrast, setReadAloud, setTextSize, type Contrast, type TextSize } from "@/lib/a11y";

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-[var(--brand)]" : "bg-black/20"}`}>
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

const SIZES: TextSize[] = ["normal", "large", "xlarge"];

export default function AccessibilityPage() {
  const { t } = useApp();
  const [readAloud, setReadAloudState] = useState(false);
  const [size, setSize] = useState<TextSize>("normal");
  const [contrast, setContrastState] = useState<Contrast>("normal");

  useEffect(() => { setReadAloudState(readReadAloud()); setSize(readTextSize()); setContrastState(readContrast()); }, []);

  const pickSize = (v: TextSize) => { setSize(v); setTextSize(v); };
  const pickContrast = (v: boolean) => { const c: Contrast = v ? "high" : "normal"; setContrastState(c); setContrast(c); };
  const pickReadAloud = (v: boolean) => { setReadAloudState(v); setReadAloud(v); };

  const sampleSize = size === "xlarge" ? "text-2xl" : size === "large" ? "text-xl" : "text-base";

  return (
    <Shell title={t("a11y_title")} back="/profile/">
      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold">{t("a11y_read_aloud")}</div>
            <p className="mt-0.5 text-sm text-[var(--muted)]">{t("a11y_read_aloud_hint")}</p>
          </div>
          <Switch on={readAloud} onChange={pickReadAloud} label={t("a11y_read_aloud")} />
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="font-semibold">{t("a11y_text_size")}</div>
        <div className="flex gap-2">
          {SIZES.map((v) => (
            <button key={v} type="button" aria-pressed={size === v} onClick={() => pickSize(v)}
              className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold ring-2 ${size === v ? "bg-[var(--brand-soft)] text-[var(--brand-ink)] ring-[var(--brand)]" : "bg-[var(--bg)] ring-black/10"}`}>
              {t(`a11y_size_${v}`)}
            </button>
          ))}
        </div>
        <p className={`rounded-xl bg-[var(--bg)] p-3 ${sampleSize}`}>{t("a11y_sample_text")}</p>
      </Card>

      <Card className="space-y-1">
        <div className="font-semibold">{t("a11y_screen_reader_title")}</div>
        <p className="text-sm text-[var(--muted)]">{t("a11y_screen_reader_desc")}</p>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold">{t("a11y_high_contrast")}</div>
            <p className="mt-0.5 text-sm text-[var(--muted)]">{t("a11y_high_contrast_hint")}</p>
          </div>
          <Switch on={contrast === "high"} onChange={pickContrast} label={t("a11y_high_contrast")} />
        </div>
      </Card>
    </Shell>
  );
}
