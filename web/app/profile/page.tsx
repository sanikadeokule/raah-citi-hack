"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { Card, Shell } from "@/components/ui";
import { useApp } from "@/lib/store";
import { categoryLabel } from "@/lib/labels";
import { placeLabel } from "@/lib/questions";
import { db, getKV } from "@/lib/db";

type Lang3 = [string, string, string]; // English, Hindi, Marathi
const FIELDS: { k: string; label: Lang3; type: "text" | "number" | "bool" | "list" | "select"; options?: string[] }[] = [
  { k: "name", label: ["Name", "नाम", "नाव"], type: "text" }, { k: "age", label: ["Age", "उम्र", "वय"], type: "number" },
  { k: "gender", label: ["Gender", "लिंग", "लिंग"], type: "select", options: ["F", "M"] }, { k: "class", label: ["Class", "कक्षा", "इयत्ता"], type: "number" },
  { k: "marks_pct", label: ["Marks %", "अंक %", "गुण %"], type: "number" },
  { k: "interests", label: ["Interests (comma separated)", "रुचियाँ (कॉमा से अलग करें)", "आवडी (स्वल्पविरामाने वेगळे करा)"], type: "list" },
  { k: "category", label: ["Category", "श्रेणी", "प्रवर्ग"], type: "select", options: ["General", "EWS", "OBC", "SC", "ST", "DNT", "EBC", "SEBC", "VJNT", "SBC", "Navbouddha"] },
  { k: "family_income_annual", label: ["Family income ₹/year", "परिवार की सालाना आय ₹", "कुटुंबाचे वार्षिक उत्पन्न ₹"], type: "number" },
  { k: "max_commute_km", label: ["Max travel km", "अधिकतम यात्रा (किमी)", "कमाल प्रवास (किमी)"], type: "number" },
  { k: "can_stay_hostel", label: ["Can stay in hostel", "हॉस्टल में रह सकते हैं", "वसतिगृहात राहू शकता"], type: "bool" },
  { k: "school_type", label: ["School type", "स्कूल का प्रकार", "शाळेचा प्रकार"], type: "select", options: ["government", "aided", "local_body", "private", "top_class"] },
  { k: "domicile", label: ["Domicile", "अधिवास", "अधिवास"], type: "text" },
  { k: "documents", label: ["Documents you have (comma separated)", "आपके पास के दस्तावेज़ (कॉमा से अलग करें)", "तुमच्याकडील कागदपत्रे (स्वल्पविरामाने वेगळी करा)"], type: "list" },
  { k: "has_bank_account", label: ["Has bank account", "बैंक खाता है", "बँक खाते आहे"], type: "bool" },
  { k: "exams_passed", label: ["Exams passed (e.g. nmms)", "पास की परीक्षाएँ (जैसे nmms)", "उत्तीर्ण परीक्षा (उदा. nmms)"], type: "list" },
  { k: "disability_pct", label: ["Disability %", "दिव्यांगता %", "दिव्यांगत्व %"], type: "number" },
  { k: "religion", label: ["Religion (some scholarships are for minority communities)", "धर्म (कुछ छात्रवृत्तियाँ अल्पसंख्यक समुदायों के लिए हैं)", "धर्म (काही शिष्यवृत्ती अल्पसंख्याक समुदायांसाठी आहेत)"], type: "select", options: ["Hindu", "Muslim", "Christian", "Sikh", "Buddhist", "Jain", "Parsi", "Other"] },
  { k: "parent_construction_worker", label: ["Parent is a registered construction worker", "माता-पिता पंजीकृत निर्माण मज़दूर हैं", "पालक नोंदणीकृत बांधकाम कामगार आहेत"], type: "bool" },
  { k: "parent_ex_serviceman", label: ["Parent is an ex-serviceman", "माता-पिता पूर्व सैनिक हैं", "पालक माजी सैनिक आहेत"], type: "bool" },
];
const TALUKA_WORD: Lang3 = ["Taluka", "तालुका", "तालुका"];
// shown names for the stored English option values (the saved value stays English)
const OPTION_TEXT: Record<string, Lang3> = {
  government: ["Government", "सरकारी", "सरकारी"], aided: ["Aided", "अनुदानित", "अनुदानित"], local_body: ["Local body", "स्थानीय निकाय", "स्थानिक स्वराज्य संस्था"],
  private: ["Private", "निजी", "खासगी"], top_class: ["Top-class", "शीर्ष श्रेणी", "अव्वल दर्जा"],
  Hindu: ["Hindu", "हिंदू", "हिंदू"], Muslim: ["Muslim", "मुस्लिम", "मुस्लिम"], Christian: ["Christian", "ईसाई", "ख्रिश्चन"], Sikh: ["Sikh", "सिख", "शीख"],
  Buddhist: ["Buddhist", "बौद्ध", "बौद्ध"], Jain: ["Jain", "जैन", "जैन"], Parsi: ["Parsi", "पारसी", "पारशी"], Other: ["Other", "अन्य", "इतर"],
};

export default function ProfilePage() {
  const { profile, setProfile, t, data, showToast, authFetch, signOut, queueAction, lang } = useApp();
  const li = lang === "hi" ? 1 : lang === "mr" ? 2 : 0;
  const optionLabel = (k: string, o: string) => k === "gender" ? t(o === "F" ? "opt_girl" : "opt_boy") : k === "category" ? categoryLabel(o, lang) : OPTION_TEXT[o]?.[li] ?? o;
  const [p, setP] = useState<any>(null);
  const [consent, setConsent] = useState<any>(null);
  useEffect(() => { if (profile) setP(profile); getKV("consent").then(setConsent); }, [profile]);
  if (!p) return <Shell title={t("your_profile")}><div /></Shell>;
  const set = (k: string, v: any) => setP({ ...p, [k]: v });
  return (
    <Shell title={t("your_profile")} back="/careers/">
      <Card className="space-y-3">
        {FIELDS.map((f) => (
          <label key={f.k} className="block text-sm">
            <span className="text-[var(--muted)]">{f.label[li]}</span>
            {f.type === "bool" ? (
              <input type="checkbox" className="ml-2 h-5 w-5 align-middle" checked={!!p[f.k]} onChange={(e) => set(f.k, e.target.checked)} />
            ) : f.type === "select" ? (
              <select value={p[f.k] ?? ""} onChange={(e) => set(f.k, e.target.value)} className="mt-1 w-full rounded-lg bg-[var(--bg)] p-2">
                <option value="" />{f.options!.map((o) => <option key={o} value={o}>{optionLabel(f.k, o)}</option>)}
              </select>
            ) : (
              <input value={f.type === "list" ? (p[f.k] || []).join(", ") : p[f.k] ?? ""} type={f.type === "number" ? "number" : "text"}
                onChange={(e) => set(f.k, f.type === "list" ? e.target.value.split(",").map((s) => s.trim()).filter(Boolean) : f.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
                className="mt-1 w-full rounded-lg bg-[var(--bg)] p-2" />
            )}
          </label>
        ))}
        <label className="block text-sm"><span className="text-[var(--muted)]">{t("field_taluka")}</span>
          <select value={p.taluka ?? ""} className="mt-1 w-full rounded-lg bg-[var(--bg)] p-2" onChange={(e) => {
            const tk = data.talukas.find((x: any) => x.name === e.target.value);
            setP({ ...p, taluka: e.target.value, lat: tk?.lat ?? p.lat, lon: tk?.lon ?? p.lon });
          }}>{data.talukas.map((x: any) => <option key={x.name} value={x.name}>{placeLabel(t, x.name)}</option>)}</select>
        </label>
        <button onClick={() => { setProfile(p); queueAction("profile", p); showToast(t("saved")); }} className="w-full rounded-xl bg-[var(--brand)] py-3 font-semibold text-white">{t("save")}</button>
      </Card>
      {consent && (
        <Card><h2 className="font-bold">{t("consent_recorded")}</h2>
          <pre className="mt-1 whitespace-pre-wrap text-xs">{JSON.stringify(consent, null, 2)}</pre></Card>
      )}
      <button onClick={async () =>{ await authFetch("/api/auth/me", { method: "DELETE" }).catch(() => null); await signOut(); await db.delete(); location.href = "/login/"; }} className="w-full rounded-xl bg-rose-100 py-3 font-semibold text-rose-800"> {t("delete_my_data")}</button>
    </Shell>
  );
}
