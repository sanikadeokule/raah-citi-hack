"use client";
// One published module, opened from "My modules". The id is a query parameter (?id=3) because the
// app is a static export, which has no per-id pages.
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Shell } from "@/components/ui";
import { TeacherModuleDetail } from "@/components/modules";
import { useApp } from "@/lib/store";

function Detail() {
  const id = Number(useSearchParams().get("id"));
  return <TeacherModuleDetail id={id} />;
}

export default function ModulePage() {
  const { t } = useApp();
  return (
    <Shell title={t("module_details")} back="/teacher/" role="teacher">
      <Suspense><Detail /></Suspense>
    </Shell>
  );
}
