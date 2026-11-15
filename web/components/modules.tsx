"use client";
// Teacher-made modules: builder + earnings for teachers, enrol + lesson + quiz for students.
// Prices are set by the teacher; the teacher's share and per-completion payout come from
// the Assumptions sheet on the server. Payments are simulated (sandbox).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { Badge, Card, SpeakButton, Stat } from "./ui";
import { inr } from "@/lib/engine";
import { useApp } from "@/lib/store";

const priceText = (m: any, t: any) =>
  m.price_model === "free" ? t("free") : m.price_model === "subscription" ? t("price_subscription", { p: inr(m.price) }) : t("price_module", { p: inr(m.price) });

// ------------------------------------------------------------------ student

export function StudentModules() {
  const { t, authFetch, online, auth, queueAction } = useApp();
  const [mods, setMods] = useState<any[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [ans, setAns] = useState<Record<number, number>>({});
  const [result, setResult] = useState<Record<number, any>>({});

  const load = useCallback(() => {
    authFetch("/api/modules").then((r) => (r.ok ? r.json() : [])).then(setMods).catch(() => {});
  }, [authFetch]);
  useEffect(() => { if (online && auth) load(); }, [online, auth, load]);

  if (!mods.length) return null;
  const enrol = async (m: any) => {
    const r = await authFetch(`/api/modules/${m.id}/enrol`, { method: "POST" });
    if (r.ok) { load(); setOpen(m.id); setAns({}); }
  };
  const finish = async (m: any) => {
    const answers = m.quiz.map((_: any, i: number) => ans[i] ?? -1);
    const r = await authFetch(`/api/modules/${m.id}/complete`, { method: "POST", body: JSON.stringify({ answers }) });
    if (r.ok) {
      const j = await r.json();
      setResult((x) => ({ ...x, [m.id]: j }));
      await queueAction("module_done", { id: m.id, score: j.score, total: j.total, at: new Date().toISOString() });
      load();
    }
  };

  return (
    <Card>
      <h2 className="mb-2 text-lg font-bold">👩‍🏫 {t("teacher_modules")}</h2>
      <ul className="space-y-2">
        {mods.map((m) => {
          const res = result[m.id];
          const shown = open === m.id;
          return (
            <li key={m.id} className="rounded-xl bg-[var(--bg)] p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div><b>{m.enrolment?.completed ? "✅ " : ""}{m.title}</b><div className="text-xs text-[var(--muted)]">{m.teacher_name || t("your_teacher")} · {m.lang.toUpperCase()}</div></div>
                <Badge tone={m.price_model === "free" ? "green" : "blue"}>{priceText(m, t)}</Badge>
              </div>
              {!m.enrolment ? (
                <button onClick={() => enrol(m)} className="mt-2 w-full rounded-lg bg-[var(--brand)] py-2 font-semibold text-white">
                  {m.price_model === "free" ? t("start") : `${t("enrol")} · ${priceText(m, t)}`}
                </button>
              ) : (
                <button onClick={() => setOpen(shown ? null : m.id)} className="mt-2 text-sm underline">{shown ? t("close") : t("open_module")}</button>
              )}
              {m.enrolment && m.enrolment.paid > 0 && <div className="mt-1 text-xs text-[var(--muted)]">{t("paid_sandbox", { p: inr(m.enrolment.paid) })}</div>}
              {shown && m.enrolment && (
                <div className="mt-2 space-y-2">
                  <p className="leading-relaxed">{m.lesson}</p>
                  <SpeakButton text={m.lesson} cache />
                  <ol className="space-y-2">
                    {m.quiz.map((q: any, i: number) => {
                      const right = res?.answers?.[i] ?? (m.enrolment.completed ? q.answer : undefined);
                      return (
                        <li key={i}>
                          <div className="font-medium">{i + 1}. {q.q}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {q.options.map((o: string, j: number) => {
                              const picked = ans[i] === j;
                              const tone = right !== undefined ? (j === right ? "bg-emerald-200 text-black" : picked ? "bg-rose-200 text-black" : "bg-[var(--card)]")
                                : picked ? "bg-[var(--brand)] text-white" : "bg-[var(--card)]";
                              return <button key={j} onClick={() => setAns({ ...ans, [i]: j })} className={`rounded-full px-3 py-1 ring-1 ring-black/10 ${tone}`}>{o}</button>;
                            })}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  {res ? <p className="font-semibold">{t("score")}: {res.score}/{res.total}</p>
                    : <button onClick={() => finish(m)} disabled={Object.keys(ans).length < m.quiz.length}
                        className="w-full rounded-lg bg-[var(--accent)] py-2 font-semibold text-white disabled:opacity-40">{t("check")}</button>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------------ teacher

const blankQ = () => ({ q: "", options: ["", ""], answer: 0 });

export function ModuleBuilder({ onSaved }: { onSaved: () => void }) {
  const { t, authFetch, lang, showToast } = useApp();
  const [title, setTitle] = useState("");
  const [mlang, setMlang] = useState(lang);
  const [lesson, setLesson] = useState("");
  const [quiz, setQuiz] = useState([blankQ()]);
  const [priceModel, setPriceModel] = useState<"free" | "per_module" | "subscription">("free");
  const [price, setPrice] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const setQ = (i: number, patch: any) => setQuiz(quiz.map((q, k) => (k === i ? { ...q, ...patch } : q)));
  const save = async () => {
    setError(null);
    const body = { title, lang: mlang, lesson, price_model: priceModel, price: priceModel === "free" ? 0 : price,
      quiz: quiz.map((q) => ({ ...q, options: q.options.filter((o) => o.trim()) })) };
    const r = await authFetch("/api/modules", { method: "POST", body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) {
      const d = j.detail;
      setError(typeof d === "string" ? d : (d?.[0] ? `${d[0].loc?.slice(1).join(" › ")}: ${String(d[0].msg).replace("Value error, ", "")}` : "Error"));
      return;
    }
    showToast(t("module_published"));
    setTitle(""); setLesson(""); setQuiz([blankQ()]); setPriceModel("free"); setPrice(0);
    onSaved();
  };

  const input = "w-full min-w-0 rounded-lg bg-[var(--bg)] p-2 text-sm";
  return (
    <Card>
      <h2 className="font-bold">🧩 {t("module_builder")}</h2>
      <div className="mt-2 grid gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("module_title")} className={input} />
        <select value={mlang} onChange={(e) => setMlang(e.target.value)} className={input}>
          <option value="mr">मराठी</option><option value="hi">हिन्दी</option><option value="en">English</option>
        </select>
        <textarea value={lesson} onChange={(e) => setLesson(e.target.value)} rows={4} placeholder={t("module_lesson")} className={input} />
        <p className="text-xs text-[var(--muted)]">🔊 {t("module_audio_note")}</p>
        {quiz.map((q, i) => (
          <div key={i} className="rounded-lg bg-[var(--bg)] p-2">
            <input value={q.q} onChange={(e) => setQ(i, { q: e.target.value })} placeholder={`${t("question")} ${i + 1}`} className="w-full rounded bg-[var(--card)] p-2 text-sm" />
            {q.options.map((o, j) => (
              <label key={j} className="mt-1 flex items-center gap-2 text-sm">
                <input type="radio" checked={q.answer === j} onChange={() => setQ(i, { answer: j })} aria-label={t("correct_answer")} />
                <input value={o} onChange={(e) => setQ(i, { options: q.options.map((x, k) => (k === j ? e.target.value : x)) })}
                  placeholder={`${t("option")} ${j + 1}`} className="min-w-0 flex-1 rounded bg-[var(--card)] p-1.5" />
              </label>
            ))}
            {q.options.length < 4 && <button onClick={() => setQ(i, { options: [...q.options, ""] })} className="mt-1 text-xs underline">+ {t("option")}</button>}
          </div>
        ))}
        {quiz.length < 10 && <button onClick={() => setQuiz([...quiz, blankQ()])} className="text-left text-sm underline">+ {t("question")}</button>}
        <div className="grid grid-cols-3 gap-1 text-sm">
          {(["free", "per_module", "subscription"] as const).map((p) => (
            <button key={p} onClick={() => setPriceModel(p)} className={`rounded-lg py-2 ${priceModel === p ? "bg-[var(--brand)] text-white" : "bg-[var(--bg)]"}`}>{t(`pm_${p}`)}</button>
          ))}
        </div>
        {priceModel !== "free" && (
          <label className="flex items-center gap-2 text-sm">₹ <input type="number" min={1} value={price || ""} onChange={(e) => setPrice(Number(e.target.value))} className={input} />
            <span className="whitespace-nowrap text-xs text-[var(--muted)]">{priceModel === "subscription" ? t("per_month") : t("per_module")}</span></label>
        )}
        <button onClick={save} className="rounded-xl bg-[var(--accent)] py-3 font-semibold text-white">{t("publish_module")}</button>
        {error && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{error}</p>}
      </div>
    </Card>
  );
}

export function TeacherModules() {
  const { t, authFetch, showToast } = useApp();
  const [mods, setMods] = useState<any[]>([]);
  const [earn, setEarn] = useState<any>(null);
  const [payout, setPayout] = useState<any>(null);
  const load = useCallback(() => {
    authFetch("/api/modules/mine").then((r) => (r.ok ? r.json() : [])).then(setMods).catch(() => {});
    authFetch("/api/modules/earnings").then((r) => (r.ok ? r.json() : null)).then(setEarn).catch(() => {});
  }, [authFetch]);
  useEffect(load, [load]);

  const payOut = async () => {
    const r = await authFetch("/api/modules/earnings/payout", { method: "POST", body: JSON.stringify({}) });
    const j = await r.json();
    if (r.ok) { setPayout(j); showToast(t("payout_sent", { p: inr(j.amount_each) })); load(); }
    else showToast(typeof j.detail === "string" ? j.detail : "Error");
  };

  return (
    <>
      <ModuleBuilder onSaved={load} />
      {earn && (
        <Card>
          <h2 className="font-bold">💰 {t("earnings")}</h2>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Stat label={t("module_sales")} value={inr(earn.sales_share)} />
            <Stat label={t("completions_label", { n: earn.completions })} value={inr(earn.completion_payouts)} />
            <Stat label={t("unpaid")} value={inr(earn.unpaid)} tone="text-[var(--good)]" />
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">{t("earnings_rule", { pct: Math.round(earn.share_of_sales * 100), p: inr(earn.payout_per_completion) })}</p>
          <button onClick={payOut} disabled={earn.unpaid <= 0} className="mt-2 w-full rounded-xl bg-[var(--brand)] py-2 font-semibold text-white disabled:opacity-40">🏦 {t("pay_out")} {inr(earn.unpaid)}</button>
          {payout && <p className="mt-2 text-xs">pain.001 {payout.msg_id} · {payout.validation.valid ? "✅" : "❌"} {payout.validation.method}</p>}
        </Card>
      )}
      {mods.length > 0 && (
        <Card>
          <h2 className="font-bold">📚 {t("my_modules")}</h2>
          <ul className="mt-2 divide-y divide-black/5">
            {mods.map((m) => (
              <li key={m.id} className="py-2 text-sm">
                <div className="flex justify-between gap-2"><b>{m.title}</b><Badge tone={m.price_model === "free" ? "green" : "blue"}>{priceText(m, t)}</Badge></div>
                <div className="text-xs text-[var(--muted)]">{t("module_stats", { e: m.enrolled, c: m.completed, s: inr(m.sales) })}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

export function MentorRequests() {
  const { t, authFetch } = useApp();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { authFetch("/api/mentors/requests").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => {}); }, [authFetch]);
  if (!rows.length) return null;
  return (
    <Card>
      <h2 className="font-bold">🤝 {t("mentor_connections")}</h2>
      <ul className="mt-2 divide-y divide-black/5 text-sm">
        {rows.map((r, i) => (
          <li key={i} className="py-1.5">{r.student.first_name || "—"} (Class {r.student.class ?? "?"}, {r.student.taluka ?? "?"}) → <b>{r.mentor}</b>
            <span className="text-xs text-[var(--muted)]"> · {new Date(r.at * 1000).toLocaleDateString()}</span></li>
        ))}
      </ul>
    </Card>
  );
}
