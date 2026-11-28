"use client";
// A row (or grid) of tabs, so a long page shows one group at a time instead of everything stacked.

export function Tabs<K extends string>({ tabs, value, onChange, cols, className = "" }: {
  tabs: { key: K; label: React.ReactNode; count?: number }[]; value: K; onChange: (k: K) => void; cols?: number; className?: string;
}) {
  return (
    <div role="tablist" className={`grid gap-1 rounded-xl bg-[var(--card)] p-1 ring-1 ring-black/5 ${className}`}
      style={{ gridTemplateColumns: `repeat(${cols ?? tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map((x) => (
        <button key={x.key} role="tab" aria-selected={value === x.key} onClick={() => onChange(x.key)}
          className={`flex items-center justify-center gap-1.5 rounded-lg px-1.5 py-2 text-sm font-semibold leading-tight ${value === x.key ? "bg-[var(--brand)] text-white" : "text-[var(--muted)]"}`}>
          <span className="min-w-0 text-center">{x.label}</span>
          {x.count !== undefined && (
            <span className={`shrink-0 rounded-full px-1.5 text-xs ${value === x.key ? "bg-white/25" : "bg-[var(--bg)]"}`}>{x.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
