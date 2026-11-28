/* eslint-disable @typescript-eslint/no-explicit-any */
export function coursesFor(data: any, career: any, plan?: any) {
  // a course is for a career when the Courses sheet lists that career's ID ("Career IDs"), or when it is the course
  // linked in the career's plan; the sheet is the only source, no guessing from words in the name
  return data.courses.filter((c: any) => plan?.linked_course === c.id || (c.career_ids ?? []).includes(career.id)).slice(0, 4);
}


/** Where "Apply via ..." should take the student: the application portal, not the scheme's information page (the
 *  Source link beside it already goes there, and ministry sites are often down). A web address written in the
 *  dataset's "Apply via" text wins; otherwise the well-known portal for the name; otherwise the source page. */
export function applyUrl(applyVia: string | undefined, source: string): string {
  const v = String(applyVia || "");
  const dom = v.match(/\b((?:[a-z0-9-]+\.)+(?:gov\.in|nic\.in|in))\b/i);
  if (dom) return `https://${dom[1].toLowerCase()}/`;
  if (/national scholarship portal|\bnsp\b/i.test(v)) return "https://scholarships.gov.in/";
  if (/mahadbt/i.test(v)) return "https://mahadbt.maharashtra.gov.in/";
  return source;
}
