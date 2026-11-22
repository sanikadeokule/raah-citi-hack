// Names stored in English in the profile (taluka, caste category), shown in the student's language.
const TALUKA: Record<string, string> = {
  Haveli: "हवेली", "Pune city": "पुणे शहर", Junnar: "जुन्नर", Ambegaon: "आंबेगाव", Khed: "खेड", Maval: "मावळ", Mulshi: "मुळशी",
  Velhe: "वेल्हे", "Haveli (Pune city)": "हवेली (पुणे शहर)", "Pune city/Haveli": "पुणे शहर / हवेली", Bhor: "भोर", Purandar: "पुरंदर", Baramati: "बारामती", Indapur: "इंदापूर", Daund: "दौंड", Shirur: "शिरूर",
};
const CATEGORY: Record<string, string> = {
  General: "सामान्य", EWS: "ईडब्ल्यूएस", OBC: "ओबीसी", SC: "एससी", ST: "एसटी", DNT: "डीएनटी", EBC: "ईबीसी",
  SEBC: "एसईबीसी", VJNT: "व्हीजेएनटी", SBC: "एसबीसी", Navbouddha: "नवबौद्ध",
};

const local = (table: Record<string, string>, v: string | undefined | null, lang: string) =>
  v && (lang === "hi" || lang === "mr") ? table[v] ?? v : v ?? "";

export const talukaLabel = (v: string | undefined | null, lang: string) => local(TALUKA, v, lang);
export const categoryLabel = (v: string | undefined | null, lang: string) => local(CATEGORY, v, lang);

const DISTRICT: Record<string, string> = { Pune: "पुणे" };
export const districtLabel = (v: string | undefined | null, lang: string) => local(DISTRICT, v, lang);

const CENTRE_TYPE: Record<string, string> = {
  "Government ITI": "सरकारी ITI", "Nursing school (ANM)": "नर्सिंग स्कूल (ANM)", "Nursing school (GNM)": "नर्सिंग स्कूल (GNM)",
  "Government Polytechnic": "सरकारी पॉलिटेक्निक",
};
export const centreTypeLabel = (v: string | undefined | null, lang: string) => local(CENTRE_TYPE, v, lang);
