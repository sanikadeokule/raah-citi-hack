/* eslint-disable @typescript-eslint/no-explicit-any */
export function coursesFor(data: any, career: any, plan?: any) {
  const words = String(career.name).toLowerCase().replace(/[()/]/g, " ").split(/\s+/).filter((w) => w.length > 3);
  const extra = career.flags?.health ? ["health", "nursing", "anm"] : [];
  return data.courses.filter((c: any) => {
    if (plan?.linked_course === c.id) return true;
    const txt = String(c.career_text).toLowerCase();
    return [...words, ...extra].some((w) => txt.includes(w));
  }).slice(0, 4);
}

