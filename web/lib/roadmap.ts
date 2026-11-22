// A student first talks to Raah's AI and builds a roadmap; everything else unlocks after that.
// The roadmap page saves profile.roadmap_career and profile.roadmap_at when the student picks one.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const ROADMAP_HREF = "/roadmap/";
export const BUILD_ROADMAP_HREF = "/discover/";

/** Pages a student can open before a roadmap exists: the steps that build it, sign-in, data sources, and
 *  notifications (official scholarship and exam notices matter even before a roadmap is chosen). */
const OPEN_BEFORE_ROADMAP = ["/", "/discover/", "/roadmap/", "/careers/", "/profile/", "/ask/", "/login/", "/data/", "/notifications/", "/parent/"];

export function hasRoadmap(profile: any, role?: string | null) {
  if (role === "teacher") return true; // teachers use every tool and preview students
  return Boolean(profile?.roadmap_at);
}

export function openBeforeRoadmap(path: string) {
  const p = path.endsWith("/") ? path : `${path}/`;
  return OPEN_BEFORE_ROADMAP.includes(p);
}
