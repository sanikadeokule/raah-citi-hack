/* eslint-disable @typescript-eslint/no-explicit-any */
// One rule for every list in the app: "your career" is the one the student saved, otherwise Raah's best match.
// Pages sort or filter by it and show a short reason; the full list always stays one tap away ("See all").
import { rankCareers } from "@/lib/engine";
import { coursesFor } from "@/lib/helpers";

export interface MyCareer { career: any; plan: any | null; saved: boolean }

export function myCareer(data: any, profile: any): MyCareer | null {
  if (!data || !profile) return null;
  const careers: any[] = data.careers ?? [];
  const pick = (c: any, saved: boolean): MyCareer => ({ career: c, saved, plan: (data.plans ?? []).find((p: any) => p.career_id === c.id) ?? null });
  const saved = careers.find((c) => c.id === profile.roadmap_career);
  if (saved) return pick(saved, true);
  if (!(profile.interests || []).length) return null;
  const best = rankCareers(data, profile, 1).find((s: any) => s.fit !== "none");
  return best ? pick(best.career, false) : null;
}

export interface Reasoned<T> { item: T; mine: boolean; reason: string | null }

/** Exams on the student's own path first (the cost plan for their career lists the exams it needs), then the rest in dataset order. */
export function examsForStudent(data: any, profile: any): Reasoned<any>[] {
  const exams: any[] = data?.exams ?? [];
  const mc = myCareer(data, profile);
  const onPath = new Set<string>(mc?.plan?.exams ?? []);
  const rows = exams.map((item) => ({ item, mine: onPath.has(item.id), reason: onPath.has(item.id) && mc ? mc.career.name : null }));
  return [...rows.filter((r) => r.mine), ...rows.filter((r) => !r.mine)];
}

/** Free courses: the ones that fit the student's career first. */
export function coursesForStudent(data: any, profile: any): Reasoned<any>[] {
  const courses: any[] = data?.courses ?? [];
  const mc = myCareer(data, profile);
  const ids = new Set<string>(mc ? coursesFor(data, mc.career, mc.plan).map((c: any) => c.id) : []);
  const rows = courses.map((item) => ({ item, mine: ids.has(item.id), reason: ids.has(item.id) && mc ? mc.career.name : null }));
  return [...rows.filter((r) => r.mine), ...rows.filter((r) => !r.mine)];
}
