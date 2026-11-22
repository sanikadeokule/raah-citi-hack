"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { Card, Shell } from "@/components/ui";
import { useApp } from "@/lib/store";
import { placeLabel } from "@/lib/questions";
import { db, getKV } from "@/lib/db";

const FIELDS: { k: string; label: string; type: "text" | "number" | "bool" | "list" | "select"; options?: string[] }[] = [
  { k: "name", label: "Name", type: "text" }, { k: "age", label: "Age", type: "number" },
  { k: "gender", label: "Gender", type: "select", options: ["F", "M"] }, { k: "class", label: "Class", type: "number" },
  { k: "marks_pct", label: "Marks %", type: "number" }, { k: "interests", label: "Interests (comma separated)", type: "list" },
  { k: "category", label: "Category", type: "select", options: ["General", "EWS", "OBC", "SC", "ST", "DNT", "EBC", "SEBC", "VJNT", "SBC", "Navbouddha"] },
  { k: "family_income_annual", label: "Family income ₹/year", type: "number" }, { k: "max_commute_km", label: "Max travel km", type: "number" },
  { k: "can_stay_hostel", label: "Can stay in hostel", type: "bool" },
  { k: "school_type", label: "School type", type: "select", options: ["government", "aided", "local_body", "private", "top_class"] },
  { k: "domicile", label: "Domicile", type: "text" }, { k: "documents", label: "Documents you have (comma separated)", type: "list" },
  { k: "has_bank_account", label: "Has bank account", type: "bool" }, { k: "exams_passed", label: "Exams passed (e.g. nmms)", type: "list" },
  { k: "disability_pct", label: "Disability %", type: "number" },
  { k: "religion", label: "Religion (some scholarships are for minority communities)", type: "select", options: ["Hindu", "Muslim", "Christian", "Sikh", "Buddhist", "Jain", "Parsi", "Other"] },
  { k: "parent_construction_worker", label: "Parent is a registered construction worker", type: "bool" },
  { k: "parent_ex_serviceman", label: "Parent is an ex-serviceman", type: "bool" },
];

export default function ProfilePage() {
  const { profile, setProfile, t, data, showToast, authFetch, signOut, queueAction } = useApp();
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
            <span className="text-[var(--muted)]">{f.label}</span>
            {f.type === "bool" ? (
              <input type="checkbox" className="ml-2 h-5 w-5 align-middle" checked={!!p[f.k]} onChange={(e) => set(f.k, e.target.checked)} />
            ) : f.type === "select" ? (
              <select value={p[f.k] ?? ""} onChange={(e) => set(f.k, e.target.value)} className="mt-1 w-full rounded-lg bg-[var(--bg)] p-2">
                <option value="" />{f.options!.map((o) => <option key={o}>{o}</option>)}
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
      <button onClick={async () => { await authFetch("/api/auth/me", { method: "DELETE" }).catch(() => null); await signOut(); await db.delete(); location.href = "/login/"; }} className="w-full rounded-xl bg-rose-100 py-3 font-semibold text-rose-800">🗑️ {t("delete_my_data")}</button>
    </Shell>
  );
}
