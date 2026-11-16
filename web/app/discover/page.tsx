"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, MicButton, Shell, SpeakButton } from "@/components/ui";
import { useApp } from "@/lib/store";
import { setKV } from "@/lib/db";
import { aiAvailable, postAi, resetAiStatus } from "@/lib/ai";
import { QUESTIONS, cleanPlace, firstMissing, type Opt } from "@/lib/questions";

// Two modes fill the same profile fields:
// - AI chat: an open-source LLM (see backend/raah/llm.py) asks questions and returns the fields it understood;
//   the server validates every field before it reaches the profile.
// - Scripted questions (lib/questions.ts): the deterministic fallback from the spec, used offline, with no model, or on request.
// Both use the same clear wording, example hints and answer chips, and the same checks on typed answers.

type Msg = { from: "raah" | "me"; text: string; hint?: string; learned?: Record<string, any>; error?: boolean };
type Mode = "checking" | "ai" | "script";

const showValue = (v: any) => (Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "✓" : "✗") : String(v));

export default function Discover() {
  const { data, lang, t, profile, setProfile, queueAction, online, auth, authReady } = useApp();
  // the registered name is already known, so the chat starts from the next question
  const knownName = auth?.user.name || null;
  const start = { language: lang, school_type: "government", domicile: "Maharashtra", has_bank_account: true, exams_passed: [], ...(knownName ? { name: knownName } : {}) };
  const [step, setStep] = useState(() => firstMissing(start));
  const [draft, setDraft] = useState<any>(start);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [multi, setMulti] = useState<string[]>([]);
  const [consent, setConsent] = useState<"none" | "asking" | "done">("none");
  const [otp, setOtp] = useState("");
  const [mode, setMode] = useState<Mode>("checking");
  const [aiMissing, setAiMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const finished = step >= QUESTIONS.length;
  // in AI mode the quick-answer chips follow the first field the model still needs
  const q = !ready || finished ? undefined : mode === "ai" ? (QUESTIONS.find((x) => x.key === aiMissing[0]) ?? QUESTIONS[firstMissing(draft)]) : mode === "script" ? QUESTIONS[step] : undefined;
  const options: Opt[] = useMemo(() => (q?.options && data ? q.options(data, t, draft) : []), [q, data, t, draft]);
  const askMsg = (i: number, p: any): Msg => {
    const { text: body, hint } = QUESTIONS[i].ask(t, p);
    const hello = knownName && msgs.length === 0 ? `${t("hello")}, ${knownName}! ` : "";
    return { from: "raah", text: hello + body, hint };
  };

  useEffect(() => { aiAvailable().then((ok) => setMode(ok ? "ai" : "script")); }, []);
  // the signed-in account loads from the phone's storage after the first render; wait for it so a
  // registered student is greeted by name and never asked for it again
  useEffect(() => {
    if (!authReady || ready) return;
    if (knownName && !draft.name) {
      const next = { ...draft, name: knownName };
      setDraft(next);
      setStep(firstMissing(next));
    }
    setReady(true);
  }, [authReady]); // eslint-disable-line react-hooks/exhaustive-deps
  // scripted mode asks each question; AI mode opens with the same greeting, then the model takes over
  useEffect(() => {
    if (!ready) return;
    if (mode === "script" && QUESTIONS[step]) setMsgs((m) => [...m, askMsg(step, draft)]);
    if (mode === "ai" && msgs.length === 0) setMsgs([askMsg(firstMissing(draft), draft)]);
  }, [step, mode, ready]); // eslint-disable-line react-hooks/exhaustive-deps
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

  /** Say what was wrong with a typed answer and keep the same question open. */
  const retry = (shown: string, error: string, vars?: Record<string, string | number>) => {
    setMsgs((m) => [...m, { from: "me", text: shown }, { from: "raah", text: t(error, vars), error: true }]);
    setText("");
  };

  const answer = (value: any, shown: string, learned?: Record<string, any>, extra: Record<string, any> = {}) => {
    if (!q) return;
    if (mode === "ai") { sendAi(shown, { [q.key]: value, ...extra }); return; }
    const next = { ...draft, [q.key]: value, ...extra };
    if (q.key === "taluka") {
      const tk = data.talukas.find((x: any) => x.name === value);
      if (tk) { next.lat = tk.lat; next.lon = tk.lon; }
    }
    setDraft(next);
    setMsgs((m) => [...m, { from: "me", text: shown, learned }]);
    setText(""); setMulti([]);
    // always go to the first unanswered question: "fix my age" sends the student back to the age question
    const n = firstMissing(next);
    if (n < QUESTIONS.length) setStep(n);
    else finish(next);
  };

  const submitText = async (raw: string) => {
    if (!raw.trim() || !q) return;
    // answers that need checking (age, exam marks) are checked here in both modes, so a 25/25 unit test never gets through
    if (q.parse) {
      const r = q.parse(raw);
      if (!r.ok) { retry(raw, r.error, r.vars); return; }
      answer(r.value, raw, { [q.key]: r.value }, r.extra);
      return;
    }
    if (mode === "ai") { sendAi(raw); return; }
    if (q.kind === "choice") {
      const low = raw.toLowerCase();
      const hit = options.find((o) => low.includes(String(o.label).toLowerCase()) || low.includes(String(o.v).toLowerCase()));
      if (hit) answer(hit.v, raw, undefined, hit.patch);
      else if (q.free && cleanPlace(raw)) {
        // a taluka we do not have on the map yet: keep it, and say centre distances will be missing
        const place = cleanPlace(raw)!;
        answer(place, raw);
        setMsgs((m) => [...m, { from: "raah", text: t("q_taluka_not_listed", { taluka: place }) }]);
      } else retry(raw, "q_pick_one");
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
          <Link href="/ask/" className="underline">💬 {t("home_ask")}</Link>
        </div>
      )}
      <div className="space-y-2">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.from === "me" ? "bg-[var(--brand)] text-white" : m.error ? "bg-amber-50 ring-1 ring-amber-300 text-amber-900" : "bg-[var(--card)] ring-1 ring-black/5"}`}>
              {m.error && "⚠️ "}{m.text}
              {m.hint && <div className="mt-1 text-xs text-[var(--muted)]">💡 {m.hint}</div>}
              {m.learned && Object.keys(m.learned).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className={`text-xs ${m.from === "me" ? "text-white/80" : "text-[var(--muted)]"}`}>{t("ai_understood")}:</span>
                  {Object.entries(m.learned).map(([k, v]) => (
                    <span key={k} className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand-ink)]">{k.replaceAll("_", " ")}: {showValue(v)}{k === "marks_pct" ? "%" : ""}</span>
                  ))}
                </div>
              )}
              {m.from === "raah" && i === msgs.length - 1 && <div className="mt-1"><SpeakButton text={m.hint ? `${m.text} ${m.hint}` : m.text} label="" /></div>}
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
                  <button key={o.label} onClick={() => (q.kind === "multi" ? setMulti(on ? multi.filter((x) => x !== o.v) : [...multi, o.v]) : answer(o.v, o.label, undefined, o.patch))}
                    className={`rounded-full px-3 py-2 text-sm ring-1 ring-black/10 ${on ? "bg-[var(--brand)] text-white" : "bg-[var(--bg)]"}`}>
                    {o.icon} {o.label}
                  </button>
                );
              })}
              {q.kind === "multi" && q.key === "documents" && multi.length === 0
                ? <button onClick={() => answer([], t("opt_none_of_these"), undefined, { documents_none: true })} className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">{t("opt_none_of_these")}</button>
                : q.kind === "multi" && <button disabled={!multi.length} onClick={() => answer(multi, options.filter((o) => multi.includes(o.v)).map((o) => o.label).join(", "))} className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">✓ {t("continue")}</button>}
            </div>
          )}
          <div className="flex items-center gap-2">
            <MicButton onText={(s) => submitText(s)} />
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitText(text)}
              placeholder={t("type_answer")} className="min-w-0 flex-1 rounded-full bg-[var(--bg)] px-4 py-3" inputMode={q.kind === "number" ? "numeric" : "text"} />
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
