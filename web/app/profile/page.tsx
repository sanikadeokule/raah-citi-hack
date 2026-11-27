"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { Card, Shell } from "@/components/ui";
import { useApp } from "@/lib/store";
import { categoryLabel } from "@/lib/labels";
import { placeLabel } from "@/lib/questions";
import { db, getKV } from "@/lib/db";

const FIELDS: { k: string; labelKey: string; type: "text" | "number" | "bool" | "list" | "select"; options?: string[] }[] = [
  { k: "name", labelKey: "profile_field_name", type: "text" }, { k: "age", labelKey: "profile_field_age", type: "number" },
  { k: "gender", labelKey: "profile_field_gender", type: "select", options: ["F", "M"] }, { k: "class", labelKey: "profile_field_class", type: "number" },
  { k: "marks_pct", labelKey: "profile_field_marks_pct", type: "number" },
  { k: "interests", labelKey: "profile_field_interests", type: "list" },
  { k: "category", labelKey: "profile_field_category", type: "select", options: ["General", "EWS", "OBC", "SC", "ST", "DNT", "EBC", "SEBC", "VJNT", "SBC", "Navbouddha"] },
  { k: "family_income_annual", labelKey: "profile_field_family_income_annual", type: "number" },
  { k: "max_commute_km", labelKey: "profile_field_max_commute_km", type: "number" },
  { k: "can_stay_hostel", labelKey: "profile_field_can_stay_hostel", type: "bool" },
  { k: "school_type", labelKey: "profile_field_school_type", type: "select", options: ["government", "aided", "local_body", "private", "top_class"] },
  { k: "domicile", labelKey: "profile_field_domicile", type: "text" },
  { k: "documents", labelKey: "profile_field_documents", type: "list" },
  { k: "has_bank_account", labelKey: "profile_field_has_bank_account", type: "bool" },
  { k: "exams_passed", labelKey: "profile_field_exams_passed", type: "list" },
  { k: "disability_pct", labelKey: "profile_field_disability_pct", type: "number" },
  { k: "religion", labelKey: "profile_field_religion", type: "select", options: ["Hindu", "Muslim", "Christian", "Sikh", "Buddhist", "Jain", "Parsi", "Other"] },
  { k: "parent_construction_worker", labelKey: "profile_field_parent_construction_worker", type: "bool" },
  { k: "parent_ex_serviceman", labelKey: "profile_field_parent_ex_serviceman", type: "bool" },
];

export default function ProfilePage() {
  const { profile, setProfile, t, data, showToast, authFetch, signOut, queueAction } = useApp();
  const optionLabel = (k: string, o: string) => k === "gender" ? t(o === "F" ? "opt_girl" : "opt_boy") : k === "category" ? categoryLabel(o, t) : (k === "school_type" || k === "religion" ? t(`profile_option_${o}`) : o);
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
            <span className="text-[var(--muted)]">{t(f.labelKey)}</span>
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
