// Names stored in English in the profile (taluka, caste category), shown in the student's language.
const TALUKA: Record<string, string> = {
  Haveli: "हवेली", "Pune city": "पुणे शहर", Junnar: "जुन्नर", Ambegaon: "आंबेगाव", Khed: "खेड", Maval: "मावळ", Mulshi: "मुळशी",
  Velhe: "वेल्हे", Bhor: "भोर", Purandar: "पुरंदर", Baramati: "बारामती", Indapur: "इंदापूर", Daund: "दौंड", Shirur: "शिरूर",
};
const CATEGORY: Record<string, string> = {
  General: "सामान्य", EWS: "ईडब्ल्यूएस", OBC: "ओबीसी", SC: "एससी", ST: "एसटी", DNT: "डीएनटी", EBC: "ईबीसी",
  SEBC: "एसईबीसी", VJNT: "व्हीजेएनटी", SBC: "एसबीसी", Navbouddha: "नवबौद्ध",
};

const local = (table: Record<string, string>, v: string | undefined | null, lang: string) =>
  v && (lang === "hi" || lang === "mr") ? table[v] ?? v : v ?? "";

export const talukaLabel = (v: string | undefined | null, lang: string) => local(TALUKA, v, lang);
export const categoryLabel = (v: string | undefined | null, lang: string) => local(CATEGORY, v, lang);
