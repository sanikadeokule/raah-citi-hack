"use client";
import { Shell } from "@/components/ui";
import { ExamsList } from "@/components/exams";
import { useApp } from "@/lib/store";

export default function ExamsPage() {
  const { t } = useApp();
  return (
    <Shell title={t("home_exams")}>
      <ExamsList />
    </Shell>
  );
}
