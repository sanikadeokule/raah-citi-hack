"use client";
import { Shell } from "@/components/ui";
import { ExamsList } from "@/components/exams";
import { useApp } from "@/lib/store";
import { useMemo } from "react";
import { examsForStudent } from "@/lib/tailor";
import { MODULE_COLOR, ModuleHero } from "@/components/modulehero";

export default function ExamsPage() {
  const { t, data, profile } = useApp();
  const rows = useMemo(() => examsForStudent(data, profile), [data, profile]);
  const mine = rows.filter((r) => r.mine).length;
  return (
    <Shell title={t("home_exams")} wide>
      <ModuleHero color={MODULE_COLOR.exams} pose="clipboard"
        line={mine ? t("hero_exams", { n: mine }) : t("hero_exams_all")}
        stats={[...(mine ? [{ icon: "star", value: mine, label: t("hero_stat_for_you") }] : []), { icon: "clipboard", value: rows.length, label: t("hero_stat_exams") }]} />
      <ExamsList />
    </Shell>
  );
}
