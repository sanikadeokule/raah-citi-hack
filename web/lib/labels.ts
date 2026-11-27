// Names stored in English in the profile (taluka, caste category), shown in the student's language.
const TALUKA: Record<string, string> = {
  Haveli: "हवेली", "Pune city": "पुणे शहर", Junnar: "जुन्नर", Ambegaon: "आंबेगाव", Khed: "खेड", Maval: "मावळ", Mulshi: "मुळशी",
  Velhe: "वेल्हे", "Haveli (Pune city)": "हवेली (पुणे शहर)", "Pune city/Haveli": "पुणे शहर / हवेली", Bhor: "भोर", Purandar: "पुरंदर", Baramati: "बारामती", Indapur: "इंदापूर", Daund: "दौंड", Shirur: "शिरूर",
};
const local = (table: Record<string, string>, v: string | undefined | null, lang: string) =>
  v && (lang === "hi" || lang === "mr") ? table[v] ?? v : v ?? "";
const catalogLabel = (prefix: string, v: string | undefined | null, t: (key: string) => string) => {
  if (!v) return "";
  const key = `${prefix}${v}`;
  const value = t(key);
  return value === key ? v : value;
};

export const talukaLabel = (v: string | undefined | null, lang: string) => local(TALUKA, v, lang);
export const categoryLabel = (v: string | undefined | null, t: (key: string) => string) => catalogLabel("category_", v, t);

const DISTRICT: Record<string, string> = { Pune: "पुणे" };
export const districtLabel = (v: string | undefined | null, lang: string) => local(DISTRICT, v, lang);

export const centreTypeLabel = (v: string | undefined | null, t: (key: string) => string) => catalogLabel("centre_type_", v, t);
