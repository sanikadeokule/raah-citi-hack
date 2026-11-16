"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, MicButton, Shell, SpeakButton } from "@/components/ui";
import { useApp } from "@/lib/store";
import { setKV } from "@/lib/db";
import { aiAvailable, postAi, resetAiStatus } from "@/lib/ai";

// Two modes fill the same profile fields:
// - AI chat: an open-source LLM (see backend/raah/llm.py) asks questions and returns the fields it understood;
//   the server validates every field before it reaches the profile.
// - Scripted questions: the deterministic fallback from the spec, used offline, with no model, or on request.
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

type Msg = { from: "raah" | "me"; text: string; learned?: Record<string, any> };
type Mode = "checking" | "ai" | "script";

const isMissing = (v: any) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
const firstMissing = (p: any, from = 0) => {
  const i = QUESTIONS.findIndex((q, k) => k >= from && isMissing(p[q.key]));
  return i === -1 ? QUESTIONS.length : i;
};
const showValue = (v: any) => (Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "✓" : "✗") : String(v));

export default function Discover() {
  const { data, lang, t, profile, setProfile, queueAction, online, auth } = useApp();
  // the registered name is already known, so the chat starts from the next question
  const knownName = auth?.user.name || null;
  const [step, setStep] = useState(knownName ? 1 : 0);
  const [draft, setDraft] = useState<any>({ language: lang, school_type: "government", domicile: "Maharashtra", has_bank_account: true, exams_passed: [], ...(knownName ? { name: knownName } : {}) });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [multi, setMulti] = useState<string[]>([]);
  const [consent, setConsent] = useState<"none" | "asking" | "done">("none");
  const [otp, setOtp] = useState("");
  const [mode, setMode] = useState<Mode>("checking");
  const [aiMissing, setAiMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const finished = step >= QUESTIONS.length;
  // in AI mode the quick-answer chips follow the first field the model still needs
  const q = finished ? undefined : mode === "ai" ? (QUESTIONS.find((x) => x.key === aiMissing[0]) ?? QUESTIONS[0]) : mode === "script" ? QUESTIONS[step] : undefined;
  const options = useMemo(() => (q?.options && data ? q.options(data) : []), [q, data]);

  useEffect(() => { aiAvailable().then((ok) => setMode(ok ? "ai" : "script")); }, []);
  // scripted mode asks each question; AI mode opens with the same greeting, then the model takes over
  useEffect(() => {
    const hello = (i: number) => (knownName && msgs.length === 0 ? `${t("hello")}, ${knownName}! ` : "") + (QUESTIONS[i].q[lang] || QUESTIONS[i].q.en);
    if (mode === "script" && QUESTIONS[step]) setMsgs((m) => [...m, { from: "raah", text: hello(step) }]);
    if (mode === "ai" && msgs.length === 0) setMsgs([{ from: "raah", text: hello(knownName ? 1 : 0) }]);
  }, [step, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, consent]);

  const finish = (next: any) => {
    setStep(QUESTIONS.length);
    setConsent(next.age && next.age < 18 ? "asking" : "done");
    if (!(next.age < 18)) save(next);
  };

  /** Hand over to the scripted questions for whatever is still missing. */
  const toScript = (p: any) => {
    const i = firstMissing(p);
    setMode("script");
    if (i >= QUESTIONS.length) finish(p);
    else setStep(i);
  };

  const sendAi = async (raw: string, patch: Record<string, any> = {}) => {
    if (!raw.trim() || busy) return;
    const base = { ...draft, ...patch };
    const history = [...msgs, { from: "me" as const, text: raw }];
    setMsgs(history); setDraft(base); setText(""); setMulti([]); setBusy(true);
    const j = await postAi("/api/chat/turn", {
      lang, profile: base,
      messages: history.map((m) => ({ role: m.from === "me" ? "user" : "assistant", content: m.text })),
    });
    setBusy(false);
    if (!j || j.fallback) { resetAiStatus(); toScript(base); return; }
    const next = { ...base, ...j.profile };
    setDraft(next);
    setAiMissing(j.missing || []);
    if (j.done || !(j.missing || []).length) {
      setMsgs((m) => [...m, { from: "raah", text: j.reply || "👍", learned: j.learned }]);
      toScript(next);
    } else {
      setMsgs((m) => [...m, { from: "raah", text: j.reply, learned: j.learned }]);
    }
  };

  const answer = (value: any, shown: string, learned?: Record<string, any>) => {
    if (!q) return;
    if (mode === "ai") { sendAi(shown, { [q.key]: value }); return; }
    const next = { ...draft, [q.key]: value };
    if (q.key === "taluka") {
      const tk = data.talukas.find((x: any) => x.name === value);
      if (tk) { next.lat = tk.lat; next.lon = tk.lon; }
    }
    setDraft(next);
    setMsgs((m) => [...m, { from: "me", text: shown, learned }]);
    setText(""); setMulti([]);
    const n = firstMissing(next, step + 1);
    if (n < QUESTIONS.length) setStep(n);
    else finish(next);
  };

  const submitText = async (raw: string) => {
    if (!raw.trim() || !q) return;
    if (mode === "ai") { sendAi(raw); return; }
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
      // interests said in the student's own words (any language) are mapped to the dataset's tags on the server
      if (!hits.length && q.key === "interests" && online) {
        const j = await postAi("/api/interests/match", { text: raw });
        if (j?.tags?.length) { const tags = j.tags.map((x: any) => x.tag); answer(tags, raw, { interests: tags }); return; }
      }
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
      {mode !== "checking" && !finished && (
        <div className="flex items-center justify-between text-xs text-[var(--muted)]">
          <span>{mode === "ai" ? `✨ ${t("ai_chat_mode")}` : `📝 ${t("quick_mode")}`}</span>
          {mode === "ai" && <button className="underline" onClick={() => toScript(draft)}>{t("use_quick_questions")}</button>}
        </div>
      )}
      <div className="space-y-2">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.from === "me" ? "bg-[var(--brand)] text-white" : "bg-[var(--card)] ring-1 ring-black/5"}`}>
              {m.text}
              {m.learned && Object.keys(m.learned).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className={`text-xs ${m.from === "me" ? "text-white/80" : "text-[var(--muted)]"}`}>{t("ai_understood")}:</span>
                  {Object.entries(m.learned).map(([k, v]) => (
                    <span key={k} className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand-ink)]">{k.replaceAll("_", " ")}: {showValue(v)}</span>
                  ))}
                </div>
              )}
              {m.from === "raah" && i === msgs.length - 1 && <div className="mt-1"><SpeakButton text={m.text} label="" /></div>}
            </div>
          </div>
        ))}
        {busy && <div className="text-sm text-[var(--muted)]">✨ {t("thinking")}</div>}
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
              placeholder={t("type_answer")} className="min-w-0 flex-1 rounded-full bg-[var(--bg)] px-4 py-3" inputMode={mode === "script" && q.kind === "number" ? "numeric" : "text"} />
            <button onClick={() => submitText(text)} disabled={busy} className="rounded-full bg-[var(--brand)] px-4 py-3 text-white disabled:opacity-40">{t("send")}</button>
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
    </Shell>
  );
}
