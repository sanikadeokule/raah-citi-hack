"use client";
// The coloured banner at the top of each module: Maina with that module's prop, a line about the student in her
// bubble, and the headline numbers as chips. Each module has its own colour (MODULE_COLOR), shared with its home tile.
import { Icon } from "@/components/icon";
import { Mascot, type Item, type Pose } from "@/components/mascot";

export const MODULE_COLOR = {
  careers: "#2563eb",
  colleges: "#4f46e5",
  scholarships: "#c2410c",
  exams: "#b45309",
  learn: "#0f766e",
  jobs: "#15803d",
} as const;

export type Stat = { icon: string; value: React.ReactNode; label: string };

export function ModuleHero({ color, item, pose = "wave", line, stats = [], children }: {
  color: string; item?: Item; pose?: Pose; line: React.ReactNode; stats?: Stat[]; children?: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl p-3 text-white shadow lg:px-6 lg:pt-3 lg:pb-3"
      style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 62%, #0b1020))` }}>
      {/* a dotted raah curving across the banner, and soft light behind Maina */}
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 300 140">
        <path d="M-10 128C60 96 110 132 170 92S260 40 310 22" stroke="#fff" strokeOpacity=".22" strokeWidth="3" strokeDasharray="2 9" strokeLinecap="round" fill="none" />
        <circle cx="270" cy="18" r="34" fill="#fff" fillOpacity=".07" />
      </svg>
      <span aria-hidden className="absolute -left-6 -bottom-8 h-36 w-36 rounded-full bg-white/15 lg:h-40 lg:w-40" />
      <div className="relative flex items-end gap-1">
        <Mascot pose={pose} item={item} size={92} className="-mb-1 -ml-1 shrink-0 lg:mr-3 lg:[&_svg.m-in]:size-[104px]" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="m-bubble relative rounded-2xl bg-white px-3 py-2 text-sm font-semibold leading-snug text-[#14213d] shadow lg:max-w-2xl lg:px-4 lg:py-2 lg:text-base">
            <span aria-hidden className="absolute -left-1.5 bottom-3 h-3 w-3 rotate-45 bg-white" />
            <span className="relative">{line}</span>
          </div>
          {stats.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {stats.map((s) => (
                <span key={s.label} className="inline-flex items-center gap-1.5 rounded-full bg-white/18 px-2.5 py-1 text-xs ring-1 ring-white/25 backdrop-blur-sm">
                  <Icon name={s.icon} size={14} />
                  <b className="text-sm">{s.value}</b>
                  <span className="opacity-90">{s.label}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {children && <div className="relative mt-3">{children}</div>}
    </section>
  );
}

/** A thin progress bar on the banner (white on the module colour). */
export function HeroBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="h-2.5 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className="h-full rounded-full bg-white transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[11px] opacity-90">{label}</div>
    </div>
  );
}

/** Segments that add up to a whole, e.g. scholarships by status. Each part: a colour, a count and a label. */
export function HeroSplit({ parts }: { parts: { color: string; n: number; label: string }[] }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  if (!total) return null;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-white/20" aria-hidden>
        {parts.filter((p) => p.n > 0).map((p) => <div key={p.label} className="h-full border-r-2 border-black/10 last:border-r-0" style={{ flexGrow: p.n, background: p.color }} />)}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {parts.map((p) => <span key={p.label} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.n} {p.label}</span>)}
      </div>
    </div>
  );
}

/** A small ring for a 0–1 score, with the percentage in the middle. */
export function Ring({ value, color, size = 40 }: { value: number; color: string; size?: number }) {
  const r = 15, c = 2 * Math.PI * r, pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${pct}%`}>
      <svg viewBox="0 0 36 36" width={size} height={size} className="-rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeOpacity=".12" strokeWidth="4" />
        <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} />
      </svg>
      <span className="absolute text-[10px] font-bold">{pct}%</span>
    </span>
  );
}

/** A thin bar for comparing one value to the biggest in its list (e.g. stipends). */
export function Meter({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(6, Math.min(100, Math.round((value / max) * 100))) : 0;
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/10" aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
