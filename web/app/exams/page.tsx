"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { Card, Shell } from "@/components/ui";
import { ExamCard } from "@/components/exams";
import { useApp } from "@/lib/store";

export default function ExamsPage() {
  const { data, t } = useApp();
  const exams = data?.exams || [];
  // which cost plans use each exam, so a student can jump from the exam to the path
  const usedBy = (id: string) => (data?.plans || []).filter((p: any) => (p.exams || []).includes(id));
  return (
    <Shell title={t("home_exams")}>
      <Card><p className="text-sm text-[var(--muted)]">{t("exams_intro")}</p></Card>
      <div className="space-y-2">
        {exams.map((e: any) => (
          <div key={e.id}>
            <ExamCard e={e} />
            {usedBy(e.id).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1 px-1">
                {usedBy(e.id).map((p: any) => <Link key={p.id} href={`/plan/?id=${p.id}`} className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand-ink)]">₹ {p.label}</Link>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </Shell>
  );
}
