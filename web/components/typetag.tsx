"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
const TYPE_KEY: Record<string, string> = { Vocational: "ctype_vocational", Diploma: "ctype_diploma", Degree: "ctype_degree", "Government job": "ctype_government" };
/** Small tag for every career: vocational, diploma, degree or government job (the sheet's Career type column). */
export function TypeTag({ c, t }: { c: any; t: (k: string) => string }) {
  const key = TYPE_KEY[c?.career_type || ""];
  if (!key) return null;
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${c.career_type === "Vocational" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>{t(key)}</span>;
}

