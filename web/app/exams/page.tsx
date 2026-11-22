"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Card, Shell } from "@/components/ui";
import { ExamTile } from "@/components/exams";
import { Pager, usePaged } from "@/components/pager";
import { useApp } from "@/lib/store";

export default function ExamsPage() {
  const { data, t } = useApp();
  const exams = data?.exams || [];
  // which cost plans use each exam, so a student can jump from the exam to the path
  const usedBy = (id: string) => (data?.plans || []).filter((p: any) => (p.exams || []).includes(id));
  const pg = usePaged(exams, 5, "exams");
  return (
    <Shell title={t("home_exams")}>
      <Card><p className="text-sm text-[var(--muted)]">{t("exams_intro")}</p></Card>
      <div ref={pg.top} />
      <div className="space-y-2">
        {pg.pageItems.map((e: any) => <ExamTile key={e.id} e={e} paths={usedBy(e.id)} />)}
      </div>
      <Pager {...pg} shown={pg.pageItems.length} />
    </Shell>
  );
}
