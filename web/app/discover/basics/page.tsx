"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, MicButton, Shell, SpeakButton } from "@/components/ui";
import { ChatInput } from "@/components/chatinput";
import { useApp } from "@/lib/store";
import { setKV } from "@/lib/db";
import { aiAvailable, postAi, resetAiStatus } from "@/lib/ai";
import { QUESTIONS, cleanPlace, firstMissing, sayGender, tagLabel, placeLabel, fieldLabel, type Opt, type Q, type T } from "@/lib/questions";

// Two modes fill the same profile fields:
// - AI chat: an open-source LLM (see backend/raah/llm.py) asks questions and returns the fields it understood;
//   the server validates every field before it reaches the profile.
// - Scripted questions (lib/questions.ts): the deterministic fallback from the spec, used offline, with no model, or on request.
// Both use the same clear wording, example hints and answer chips, and the same checks on typed answers.

// `tr` rebuilds a bubble in the language chosen now, so switching language re-translates the whole chat,
// not only the newest question. `text` is the fallback (the model's own replies and typed answers), and
// `lang` is the language that fallback text was written in, for read-aloud.
type Msg = { from: "raah" | "me"; text: string; hint?: string; tr?: (t: T) => { text: string; hint?: string }; learned?: Record<string, any>; error?: boolean; lang?: string };
type Say = string | ((t: T) => string);
type Mode = "checking" | "ai" | "script";

const showValue = (v: any) => (Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "✓" : "✗") : String(v));

export default function Discover() {
  const { data, lang, setLang, t, profile, setProfile, queueAction, online, auth, authReady } = useApp();
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
  // what the student actually tapped ("₹4.5 to 8 lakh"), shown in "Understood" instead of the single number stored for a band
  const [labels, setLabels] = useState<Record<string, (t: T) => string>>({});
  const dropLabels = (keys: string[]) => setLabels((l) => { const n = { ...l }; keys.forEach((k) => delete n[k]); return n; });
  const [ready, setReady] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const finished = step >= QUESTIONS.length;
  // in AI mode the quick-answer chips follow the first field the model still needs
  const q = !ready || finished ? undefined : mode === "ai" ? (QUESTIONS.find((x) => x.key === aiMissing[0]) ?? QUESTIONS[firstMissing(draft)]) : mode === "script" ? QUESTIONS[step] : undefined;
  // no chips while the model is thinking: they would belong to the question just answered, not the one coming next
  const options: Opt[] = useMemo(() => (q?.options && data && !busy ? q.options(data, t, draft) : []), [q, data, t, draft, busy]);
  const view = (m: Msg) => (m.tr ? m.tr(t) : { text: m.text, hint: m.hint });
  /** A message from the locale files: stored as a key, so it follows the language switch. */
  const say = (tr: (t: T) => string, error = false): Msg => ({ from: "raah", text: tr(t), tr: (tt) => ({ text: tr(tt) }), error });
  const askMsg = (i: number, p: any): Msg => {
    const name = knownName && msgs.length === 0 ? knownName : null;
    const tr = (tt: T) => {
      const { text: body, hint } = QUESTIONS[i].ask(tt, p);
      return { text: (name ? `${tt("hello")}, ${name}! ` : "") + body, hint };
    };
    return { from: "raah", ...tr(t), tr };
  };
  /** Label(s) of the tapped chip(s), looked up again by position so they show in the current language. */
  const chipLabel = (qq: Q, p: any, idx: number[]) => (tt: T) => {
    const opts = qq.options?.(data, tt, p) ?? [];
    return idx.map((i) => opts[i]?.label ?? "").join(", ");
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

  const sendAi = async (raw: string, patch: Record<string, any> = {}, replyLang = lang) => {
    if (!raw.trim() || busy) return;
    const base = { ...draft, ...patch };
    const history = [...msgs, { from: "me" as const, text: raw }];
    setMsgs(history); setDraft(base); setText(""); setMulti([]); setBusy(true);
    const j = await postAi("/api/chat/turn", {
      lang: replyLang, profile: base,
      messages: history.map((m) => ({ role: m.from === "me" ? "user" : "assistant", content: view(m).text })),
    });
    setBusy(false);
    if (!j || j.fallback) {
      resetAiStatus();
      // say why the AI chat stopped, so it is clear whether the server, the model name or a timeout is the cause
      const why = !j ? "the Raah server did not answer" : j.reason || "no model answered";
      setMsgs((m) => [...m, say((tt) => `${tt("ai_fallback_note")} (${why})`, true)]);
      toScript(base);
      return;
    }
    const next = { ...base, ...j.profile };
    dropLabels(Object.keys(j.learned || {}));
    setDraft(next);
    setAiMissing(j.missing || []);
    if (j.done || !(j.missing || []).length) {
      setMsgs((m) => [...m, { from: "raah", text: j.reply || "OK", learned: j.learned, lang: replyLang }]);
      toScript(next);
    } else {
      setMsgs((m) => [...m, { from: "raah", text: j.reply, learned: j.learned, lang: replyLang }]);
    }
  };

  /** Say what was wrong with a typed answer and keep the same question open. */
  const retry = (shown: string, error: string, vars?: Record<string, string | number>) => {
    setMsgs((m) => [...m, { from: "me", text: shown }, say((tt) => tt(error, vars), true)]);
    setText("");
  };

  // tap: the answer came from a chip, so the next question is the app's own (same wording as the chips), not the model's.
  // Letting the model reply to a tap could repeat the question just answered while the chips already show the next one.
  const answer = (value: any, said: Say, learned?: Record<string, any>, extra: Record<string, any> = {}, tap = false, replyLang = lang) => {
    if (!q) return;
    const shown = typeof said === "string" ? said : said(t);
    const tr = typeof said === "string" ? undefined : (tt: T) => ({ text: said(tt) });
    if (tap && typeof said !== "string") setLabels((l) => ({ ...l, [q.key]: said })); else dropLabels([q.key]);
    if (mode === "ai" && !tap) { sendAi(shown, { [q.key]: value, ...extra }, replyLang); return; }
    const next = { ...draft, [q.key]: value, ...extra };
    if (q.key === "taluka") {
      const tk = data.talukas.find((x: any) => x.name === value);
      if (tk) { next.lat = tk.lat; next.lon = tk.lon; }
    }
    setDraft(next);
    setMsgs((m) => [...m, { from: "me", text: shown, tr, learned: tap && !learned ? { [q.key]: value } : learned }]);
    setText(""); setMulti([]);
    // always go to the first unanswered question: "fix my age" sends the student back to the age question
    const n = firstMissing(next);
    if (mode === "ai") {
      setAiMissing([]);
      if (n < QUESTIONS.length) setMsgs((m) => [...m, askMsg(n, next)]);
    }
    if (n < QUESTIONS.length) setStep(n);
    else finish(next);
  };

  const submitText = async (raw: string, detectedLang?: string) => {
    if (!raw.trim() || !q) return;
    const replyLang = detectedLang || lang;
    if (detectedLang) setLang(detectedLang);
    // answers that need checking (age, exam marks) are checked here in both modes, so a 25/25 unit test never gets through
    if (q.parse) {
      const r = q.parse(raw);
      if (!r.ok) { retry(raw, r.error, r.vars); return; }
      const g = q.key === "age" && !draft.gender ? sayGender(raw) : undefined;
      answer(r.value, raw, { [q.key]: r.value, ...(g ? { gender: g } : {}) }, { ...r.extra, ...(g ? { gender: g } : {}) }, false, replyLang);
      return;
    }
    if (mode === "ai") { sendAi(raw, {}, replyLang); return; }
    if (q.kind === "choice") {
      const low = raw.toLowerCase();
      const hit = options.find((o) => low.includes(String(o.label).toLowerCase()) || low.includes(String(o.v).toLowerCase()));
      if (hit) answer(hit.v, raw, undefined, hit.patch, false, replyLang);
      else if (q.free && cleanPlace(raw)) {
        // a taluka we do not have on the map yet: keep it, and say centre distances will be missing
        const place = cleanPlace(raw)!;
        answer(place, raw, undefined, {}, false, replyLang);
        setMsgs((m) => [...m, say((tt) => tt("q_taluka_not_listed", { taluka: place }))]);
      } else retry(raw, "q_pick_one");
    } else if (q.kind === "multi") {
      const low = raw.toLowerCase();
      const hits = options.filter((o) => low.includes(String(o.v).toLowerCase()) || low.includes(String(o.label).toLowerCase())).map((o) => o.v);
      // interests said in the student's own words (any language) are mapped to the dataset's tags on the server
      if (!hits.length && q.key === "interests" && online) {
        const j = await postAi("/api/interests/match", { text: raw });
        if (j?.tags?.length) { const tags = j.tags.map((x: any) => x.tag); answer(tags, raw, { interests: tags }, {}, false, replyLang); return; }
      }
      answer(hits.length ? hits : raw.split(/,|और|आणि|and/).map((s) => s.trim()).filter(Boolean), raw, undefined, {}, false, replyLang);
    } else answer(raw.trim(), raw, undefined, {}, false, replyLang);
  };

  /** The one button: sends the chips ticked on a multi-choice question (plus anything typed), otherwise the typed answer. */
  const send = () => {
    if (busy || !q) return;
    if (q.kind === "multi" && multi.length && !text.trim()) {
      const idx = options.flatMap((o, i) => (multi.includes(o.v) ? [i] : []));
      answer(multi, chipLabel(q, draft, idx), undefined, {}, true);
    } else submitText(text);
  };
  const canSend = !busy && (text.trim().length > 0 || (q?.kind === "multi" && multi.length > 0));

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
          <span>{mode === "ai" ? `${t("ai_chat_mode")}` : `${t("quick_mode")}`}</span>
          {mode === "ai" && <button className="underline" onClick={() => toScript(draft)}>{t("use_quick_questions")}</button>}
          <Link href="/ask/" className="underline"> {t("home_ask")}</Link>
        </div>
      )}
      <div className="space-y-2">
        {msgs.map((m, i) => { const v = view(m); return (
          <div key={i} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.from === "me" ? "bg-[var(--brand)] text-white" : m.error ? "bg-amber-50 ring-1 ring-amber-300 text-amber-900" : "bg-[var(--card)] ring-1 ring-black/5"}`}>
              {m.error && "! "}{v.text}
              {v.hint && <div className="mt-1 text-xs text-[var(--muted)]">{v.hint}</div>}
              {m.learned && Object.keys(m.learned).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className={`text-xs ${m.from === "me" ? "text-white/80" : "text-[var(--muted)]"}`}>{t("ai_understood")}:</span>
                  {Object.entries(m.learned).map(([k, val]) => (
                    <span key={k} className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand-ink)]">{fieldLabel(t, k)}: {labels[k]?.(t) ?? (k === "interests" && Array.isArray(val) ? val.map((x) => tagLabel(t, x)).join(", ") : k === "taluka" ? placeLabel(t, val) : showValue(val))}{k === "marks_pct" ? "%" : ""}</span>
                  ))}
                </div>
              )}
              {m.from === "raah" && i === msgs.length - 1 && <div className="mt-1"><SpeakButton text={v.hint ? `${v.text} ${v.hint}` : v.text} label="" lang={m.tr ? lang : m.lang} /></div>}
            </div>
          </div>
        ); })}
        {busy && <div className="text-sm text-[var(--muted)]">{t("thinking")}</div>}
        <div ref={end} />
      </div>

      {q && (
        <Card className="sticky bottom-2">
          {options.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {options.map((o, oi) => {
                const on = multi.includes(o.v);
                return (
                  <button key={o.label} onClick={() => (q.kind === "multi" ? setMulti(on ? multi.filter((x) => x !== o.v) : [...multi, o.v]) : answer(o.v, chipLabel(q, draft, [oi]), undefined, o.patch, true))}
                    className={`rounded-full px-3 py-2 text-sm ring-1 ring-black/10 ${on ? "bg-[var(--brand)] text-white" : "bg-[var(--bg)]"}`}>
                    {o.label}
                  </button>
                );
              })}
              {q.kind === "multi" && q.key === "documents" && multi.length === 0 && (
                <button onClick={() => answer([], (tt) => tt("opt_none_of_these"), undefined, { documents_none: true }, true)} className="rounded-full px-3 py-2 text-sm ring-1 ring-black/10 bg-[var(--bg)]">{t("opt_none_of_these")}</button>
              )}
            </div>
          )}
          <div className="flex items-end gap-2">
            <MicButton onText={(s, detectedLang) => submitText(s, detectedLang)} />
            <ChatInput value={text} onChange={setText} onSend={() => { if (canSend) send(); }}
              placeholder={t("type_answer")} inputMode={q.kind === "number" || q.key === "max_commute_km" ? "numeric" : "text"} />
            <button onClick={send} disabled={!canSend} className="rounded-full bg-[var(--brand)] px-4 py-3 text-white disabled:opacity-40">{t("send")}</button>
          </div>
        </Card>
      )}

      {consent === "asking" && (
        <Card>
          <h2 className="text-lg font-bold">{t("consent_title")}</h2>
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
          <p className="font-semibold">{t("consent_recorded")} · {t("saved")}</p>
          <Link href="/careers/" className="mt-3 block rounded-xl bg-[var(--brand)] py-3 text-center font-semibold text-white">{t("shortlist")} →</Link>
          <Link href="/profile/" className="mt-2 block text-center text-sm underline">{t("edit_profile")}</Link>
        </Card>
      )}
    </Shell>
  );
}
