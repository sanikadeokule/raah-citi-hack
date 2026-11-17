"use client";
// One career dropdown for the whole Apprenticeships page: it drives the mentors, NAPS and railway lists.
// Every career in the spreadsheet is offered, with how many mentors + openings it has.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo } from "react";
import { countsByCareer, type CareerChoice, type Picked } from "@/lib/listings";
import { useApp } from "@/lib/store";

export function CareerFilter({ value, onChange }: { value: CareerChoice; onChange: (v: CareerChoice) => void }) {
  const { data, t } = useApp();
  const counts = useMemo(() => countsByCareer(data), [data]);
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-semibold">{t("career_filter")}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full min-w-0 rounded-xl bg-[var(--card)] p-3 ring-1 ring-black/10">
        <option value="top">{t("career_top")}</option>
        <option value="all">{t("career_all")}</option>
        {(data?.careers || []).map((c: any) => <option key={c.id} value={c.id}>{c.name} ({counts[c.id] ?? 0})</option>)}
      </select>
    </label>
  );
}

// Says when a list is showing related careers, or has nothing at all for the chosen career.
export function RelatedNote({ picked }: { picked: Picked<any> }) {
  const { t } = useApp();
  if (picked.related) {
    return <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{t("showing_related", { names: picked.related.map((c) => c.name).join(", ") })}</p>;
  }
  if (!picked.items.length) return <p className="mt-2 rounded-lg bg-[var(--bg)] p-2 text-sm text-[var(--muted)]">{t("none_for_career")}</p>;
  return null;
}
