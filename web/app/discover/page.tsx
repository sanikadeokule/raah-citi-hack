"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, MicButton, Shell, SpeakButton } from "@/components/ui";
import { API, useApp } from "@/lib/store";
import { setKV } from "@/lib/db";

// Scripted question flow: the deterministic fallback from the spec (works with no LLM and offline).
// When /api/chat is configured with an LLM key it can rephrase questions; answers always land in the same profile fields.
type Q = { key: string; q: Record<string, string>; kind: "text" | "number" | "choice" | "multi"; options?: (d: any) => { v: any; label: string; icon?: string }[] };

const QUESTIONS: Q[] = [
  { key: "name", kind: "text", q: { en: "Hi! I'm Raah. What is your name?", mr: "नमस्कार! मी राह. तुमचं नाव काय?", hi: "नमस्ते! मैं राह हूँ। आपका नाम क्या है?" } },
  { key: "age", kind: "number", q: { en: "How old are you?", mr: "तुमचं वय किती?", hi: "आपकी उम्र कितनी है?" } },
  { key: "gender", kind: "choice", q: { en: "Are you a girl or a boy?", mr: "तुम्ही मुलगी आहात की मुलगा?", hi: "आप लड़की हैं या लड़का?" },
    options: () => [{ v: "F", label: "Girl / मुलगी", icon: "👧" }, { v: "M", label: "Boy / मुलगा", icon: "👦" }] },
  { key: "class", kind: "choice", q: { en: "Which class are you in?", mr: "तुम्ही कोणत्या इयत्तेत आहात?", hi: "आप किस कक्षा में हैं?" },
    options: () => [8, 9, 10, 11, 12].map((c) => ({ v: c, label: String(c) })) },
  { key: "interests", kind: "multi", q: { en: "What do you enjoy? Pick any.", mr: "तुम्हाला काय आवडतं? कितीही निवडा.", hi: "आपको क्या पसंद है? कुछ भी चुनें।" },
    options: (d) => {
      const count: Record<string, number> = {};
      d.careers.forEach((c: any) => c.tags.forEach((t: string) => (count[t] = (count[t] || 0) + 1)));
      return Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([t]) => ({ v: t, label: t }));
    } },
  { key: "marks_pct", kind: "number", q: { en: "What % did you get in your last exam?", mr: "मागच्या परीक्षेत किती टक्के मिळाले?", hi: "पिछली परीक्षा में कितने प्रतिशत आए?" } },
  { key: "taluka", kind: "choice", q: { en: "Which taluka do you live in?", mr: "तुम्ही कोणत्या तालुक्यात राहता?", hi: "आप किस तालुका में रहते हैं?" },
    options: (d) => d.talukas.filter((t: any) => t.name !== "Pune city").map((t: any) => ({ v: t.name, label: t.name })) },
  { key: "category", kind: "choice", q: { en: "Your category (for scholarships)?", mr: "तुमचा प्रवर्ग (शिष्यवृत्तीसाठी)?", hi: "आपकी श्रेणी (छात्रवृत्ति के लिए)?" },
    options: () => ["General", "EWS", "OBC", "SC", "ST", "DNT", "EBC", "SEBC"].map((c) => ({ v: c, label: c })) },
  { key: "family_income_annual", kind: "choice", q: { en: "Family income in a year, roughly?", mr: "कुटुंबाचे वर्षाचे उत्पन्न साधारण?", hi: "परिवार की सालाना आय लगभग?" },
    options: () => [[100000, "< ₹1 lakh"], [180000, "₹1–2 lakh"], [240000, "₹2–2.5 lakh"], [320000, "₹2.5–3.5 lakh"], [450000, "₹3.5–4.5 lakh"], [700000, "₹4.5–8 lakh"], [900000, "> ₹8 lakh"]].map(([v, l]) => ({ v, label: String(l) })) },
  { key: "max_commute_km", kind: "choice", q: { en: "How far can you travel each day?", mr: "रोज किती लांब जाऊ शकता?", hi: "रोज़ कितनी दूर जा सकते हैं?" },
    options: () => [5, 10, 20, 35, 50].map((k) => ({ v: k, label: `${k} km`, icon: "🚌" })) },
  { key: "can_stay_hostel", kind: "choice", q: { en: "Can you stay in a hostel?", mr: "वसतिगृहात राहू शकता का?", hi: "क्या आप छात्रावास में रह सकते हैं?" },
    options: () => [{ v: true, label: "Yes / हो", icon: "🏠" }, { v: false, label: "No / नाही", icon: "🚫" }] },
  { key: "documents", kind: "multi", q: { en: "Which documents do you already have?", mr: "तुमच्याकडे कोणती कागदपत्रे आहेत?", hi: "आपके पास कौन से दस्तावेज़ हैं?" },
    options: () => ["aadhaar", "marksheet_10", "caste_certificate", "income_certificate", "domicile_certificate", "bank_passbook"].map((d) => ({ v: d, label: d.replaceAll("_", " ") })) },
];

type Msg = { from: "raah" | "me"; text: string };

export default function Discover() {
  const { data, lang, t, profile, setProfile, queueAction } = useApp();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<any>({ language: lang, school_type: "government", domicile: "Maharashtra", has_bank_account: true, exams_passed: [] });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [multi, setMulti] = useState<string[]>([]);
  const [consent, setConsent] = useState<"none" | "asking" | "done">("none");
  const [otp, setOtp] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const q = QUESTIONS[step];
  const qText = q ? (q.q[lang] || q.q.en) : "";
  const options = useMemo(() => (q?.options && data ? q.options(data) : []), [q, data]);

  useEffect(() => { if (q) setMsgs((m) => [...m, { from: "raah", text: qText }]); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, consent]);

  const answer = (value: any, shown: string) => {
    const next = { ...draft, [q.key]: value };
    if (q.key === "taluka") {
      const tk = data.talukas.find((x: any) => x.name === value);
      if (tk) { next.lat = tk.lat; next.lon = tk.lon; }
    }
    setDraft(next);
    setMsgs((m) => [...m, { from: "me", text: shown }]);
    setText(""); setMulti([]);
    if (step + 1 < QUESTIONS.length) setStep(step + 1);
    else { setStep(step + 1); setConsent(next.age && next.age < 18 ? "asking" : "done"); if (!(next.age < 18)) save(next); }
  };

  const submitText = (raw: string) => {
    if (!raw.trim()) return;
    if (q.kind === "number") {
      const n = Number((raw.match(/\d+(\.\d+)?/) || [])[0]);
      if (!Number.isFinite(n)) return;
      answer(n, raw);
    } else if (q.kind === "choice") {
      const hit = options.find((o) => raw.toLowerCase().includes(String(o.label).toLowerCase().split(" /")[0]) || raw.toLowerCase().includes(String(o.v).toLowerCase()));
      if (hit) answer(hit.v, raw);
      else answer(raw, raw);
    } else if (q.kind === "multi") {
      const hits = options.filter((o) => raw.toLowerCase().includes(String(o.v).toLowerCase())).map((o) => o.v);
      answer(hits.length ? hits : raw.split(/,|और|आणि|and/).map((s) => s.trim()).filter(Boolean), raw);
    } else answer(raw.trim(), raw);
  };

  const save = async (p: any) => {
    const prof = { ...p, id: undefined };
    setProfile(prof);
    await queueAction("profile", prof);
  };

  const giveConsent = async () => {
    if (otp !== "1234") return;
    const record = { purpose: "Career guidance and scholarship matching", student: draft.name, by: "Parent (OTP sandbox)", at: new Date().toISOString(), lawful_basis: "DPDP Act 2023, verifiable parental consent (s.9)" };
    await setKV("consent", record);
    await queueAction("consent", record);
    await save(draft);
    setConsent("done");
  };

  return (
    <Shell title={t("home_discover")}>
      <div className="space-y-2">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.from === "me" ? "bg-[var(--brand)] text-white" : "bg-[var(--card)] ring-1 ring-black/5"}`}>
              {m.text}
              {m.from === "raah" && i === msgs.length - 1 && <div className="mt-1"><SpeakButton text={m.text} label="" /></div>}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>

      {q && (
        <Card className="sticky bottom-2">
          {options.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {options.map((o) => {
                const on = multi.includes(o.v);
                return (
                  <button key={String(o.v)} onClick={() => (q.kind === "multi" ? setMulti(on ? multi.filter((x) => x !== o.v) : [...multi, o.v]) : answer(o.v, o.label))}
                    className={`rounded-full px-3 py-2 text-sm ring-1 ring-black/10 ${on ? "bg-[var(--brand)] text-white" : "bg-[var(--bg)]"}`}>
                    {o.icon} {o.label}
                  </button>
                );
              })}
              {q.kind === "multi" && <button onClick={() => answer(multi, multi.join(", "))} className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">✓ {t("continue")}</button>}
            </div>
          )}
          <div className="flex items-center gap-2">
            <MicButton onText={(s) => submitText(s)} />
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitText(text)}
              placeholder={t("type_answer")} className="min-w-0 flex-1 rounded-full bg-[var(--bg)] px-4 py-3" inputMode={q.kind === "number" ? "numeric" : "text"} />
            <button onClick={() => submitText(text)} className="rounded-full bg-[var(--brand)] px-4 py-3 text-white">{t("send")}</button>
          </div>
        </Card>
      )}

      {consent === "asking" && (
        <Card>
          <h2 className="text-lg font-bold">👪 {t("consent_title")}</h2>
          <p className="mt-1 text-sm">{t("consent_text", { name: draft.name })}</p>
          <p className="mt-2 text-xs text-[var(--muted)]">{t("otp")}</p>
          <div className="mt-2 flex gap-2">
            <input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" maxLength={4} className="w-24 rounded-lg bg-[var(--bg)] p-2 text-center text-lg tracking-widest" />
            <button onClick={giveConsent} disabled={otp !== "1234"} className="flex-1 rounded-lg bg-[var(--brand)] py-2 font-semibold text-white disabled:opacity-40">{t("verify")}</button>
          </div>
        </Card>
      )}
      {consent === "done" && profile && (
        <Card>
          <p className="font-semibold">✅ {t("consent_recorded")} · {t("saved")}</p>
          <Link href="/careers/" className="mt-3 block rounded-xl bg-[var(--brand)] py-3 text-center font-semibold text-white">{t("shortlist")} →</Link>
          <Link href="/profile/" className="mt-2 block text-center text-sm underline">{t("edit_profile")}</Link>
        </Card>
      )}
      <p className="text-center text-xs text-[var(--muted)]">{API ? "" : ""}</p>
    </Shell>
  );
}
