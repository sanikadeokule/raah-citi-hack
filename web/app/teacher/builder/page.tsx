"use client";
// The module builder on its own page, so the class dashboard stays uncluttered.
import { useRouter } from "next/navigation";
import { Shell } from "@/components/ui";
import { ModuleBuilder } from "@/components/modules";
import { useApp } from "@/lib/store";

export default function ModuleBuilderPage() {
  const { t } = useApp();
  const router = useRouter();
  const saved = () => {
    // back to the dashboard, on the tab that lists the new module
    try { sessionStorage.setItem("teacher_tab", "modules"); } catch {}
    router.push("/teacher/");
  };
  return (
    <Shell title={t("module_builder")} back="/teacher/" role="teacher">
      <ModuleBuilder onSaved={saved} />
    </Shell>
  );
}
