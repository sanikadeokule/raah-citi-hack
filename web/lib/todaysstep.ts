/* eslint-disable @typescript-eslint/no-explicit-any */
// Today's step on the home screen. Day 1: a plain rule from the profile. The agent that decides it from progress and
// deadlines replaces this later; the card (title, reason, optional source, link) stays the same.
import { myCareer } from "@/lib/tailor";

export interface Step { key: string; href: string; vars?: Record<string, string>; source?: string }

export function todaysStep(data: any, profile: any): Step {
  if (!profile?.roadmap_at) return { key: "step_find_career", href: "/discover/" };
  const mc = myCareer(data, profile);
  const exam = mc?.plan?.exams?.map((id: string) => data.exams?.find((e: any) => e.id === id)).find(Boolean);
  if (exam) return { key: "step_exam", href: "/exams/", vars: { exam: exam.name, career: mc!.career.name }, source: exam.source };
  return { key: "step_scholarships", href: "/eligibility/", vars: { career: mc?.career.name ?? "" } };
}
