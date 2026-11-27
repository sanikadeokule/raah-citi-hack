"use client";
// Teacher-made modules: builder + earnings for teachers, enrol + lesson + quiz for students.
// Prices are set by the teacher; the teacher's share and per-completion payout come from
// the Assumptions sheet on the server. Payments are simulated (sandbox).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Icon, Mark } from "@/components/icon";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Card, SpeakButton, Stat } from "./ui";
import { inr } from "@/lib/engine";
import { useApp } from "@/lib/store";
import { REGISTERED_LANGUAGES } from "@/lib/languages";

declare global {
  interface Window { Razorpay?: new (options: any) => { open: () => void } }
}

function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay-checkout]');
    const script = existing ?? document.createElement("script");
    const done = () => resolve(Boolean(window.Razorpay));
    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", done, { once: true });
    if (!existing) {
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.dataset.razorpayCheckout = "true";
      document.body.appendChild(script);
    }
  });
}

const priceText = (m: any, t: any) =>
  m.price_model === "free" ? t("free") : m.price_model === "subscription" ? t("price_subscription", { p: inr(m.price) }) : t("price_module", { p: inr(m.price) });

// ------------------------------------------------------------------ student

export function StudentModules({ emptyText }: { emptyText?: string } = {}) {
  const { t, authFetch, online, auth, queueAction, showToast } = useApp();
  const [mods, setMods] = useState<any[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [ans, setAns] = useState<Record<number, number>>({});
  const [result, setResult] = useState<Record<number, any>>({});
  const [paying, setPaying] = useState<number | null>(null);

  const load = useCallback(() => {
    authFetch("/api/modules").then((r) => (r.ok ? r.json() : [])).then(setMods).catch(() => {});
  }, [authFetch]);
  useEffect(() => { if (online && auth) load(); }, [online, auth, load]);

  if (!mods.length) return emptyText ? <Card><p className="text-sm text-[var(--muted)]">{emptyText}</p></Card> : null;
  const enrol = async (m: any) => {
    setPaying(m.id);
    try {
      const r = await authFetch(`/api/modules/${m.id}/enrol`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : t("module_enrol_error"));
      if (j.enrolled) { load(); setOpen(m.id); setAns({}); return; }
      if (!j.payment_required) throw new Error(t("module_payment_setup_error"));
      if (!(await loadRazorpay()) || !window.Razorpay) throw new Error(t("module_razorpay_error"));
      const checkout = new window.Razorpay({
        key: j.key_id, amount: j.order.amount, currency: j.order.currency,
        name: j.name, description: j.description, order_id: j.order.id,
        prefill: { name: auth?.user.name || "", contact: auth?.user.phone ? `+91${auth.user.phone}` : "" },
        theme: { color: "#2563eb" },
        handler: async (response: any) => {
          try {
            const verified = await authFetch(`/api/modules/${m.id}/payment/verify`, {
              method: "POST", body: JSON.stringify({ order_id: response.razorpay_order_id,
                payment_id: response.razorpay_payment_id, signature: response.razorpay_signature }),
            });
            const confirmation = await verified.json();
            if (!verified.ok) throw new Error(typeof confirmation.detail === "string" ? confirmation.detail : t("module_payment_verify_error"));
            showToast(t("module_payment_confirmed"));
            load(); setOpen(m.id); setAns({});
          } catch (err) { showToast(err instanceof Error ? err.message : t("module_payment_verify_error")); }
        },
        modal: { ondismiss: () => setPaying(null) },
      });
      checkout.open();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("module_enrol_error"));
    } finally { setPaying(null); }
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
      <h2 className="mb-2 text-lg font-bold">{t("teacher_modules")}</h2>
      <ul className="space-y-2">
        {mods.map((m) => {
          const res = result[m.id];
          const shown = open === m.id;
          return (
            <li key={m.id} className="rounded-xl bg-[var(--bg)] p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div><b>{m.enrolment?.completed && <><Mark kind="yes" size={14} /> </>}{m.title}</b><div className="text-xs text-[var(--muted)]">{m.teacher_name || t("your_teacher")} · {m.lang.toUpperCase()}</div></div>
                <Badge tone={m.price_model === "free" ? "green" : "blue"}>{priceText(m, t)}</Badge>
              </div>
              {!m.enrolment ? (
                <button onClick={() => enrol(m)} disabled={paying === m.id} className="mt-2 w-full rounded-lg bg-[var(--brand)] py-2 font-semibold text-white disabled:opacity-50">
                  {paying === m.id ? "Connecting to Razorpay…" : m.price_model === "free" ? t("start") : `${t("enrol")} · ${priceText(m, t)}`}
                </button>
              ) : (
                <button onClick={() => setOpen(shown ? null : m.id)} className="mt-2 text-sm underline">{shown ? t("close") : t("open_module")}</button>
              )}
              {m.enrolment && m.enrolment.paid > 0 && <div className="mt-1 text-xs text-[var(--muted)]">{t("module_paid_via", { amount: inr(m.enrolment.paid) })}</div>}
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
  const [mlang, setMlang] = useState(["en", "hi", "mr"].includes(lang) ? lang : "en");
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
      <h2 className="font-bold">{t("module_builder")}</h2>
      <div className="mt-2 grid gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("module_title")} className={input} />
        <select value={mlang} onChange={(e) => setMlang(e.target.value)} className={input}>
          <option value="mr">मराठी</option><option value="hi">हिन्दी</option><option value="en">English</option>
        </select>
        <textarea value={lesson} onChange={(e) => setLesson(e.target.value)} rows={4} placeholder={t("module_lesson")} className={input} />
        <p className="text-xs text-[var(--muted)]">{t("module_audio_note")}</p>
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
      <Link href="/teacher/builder/" className="flex items-center gap-3 rounded-2xl border-b-4 border-[var(--accent)] bg-[var(--brand)] px-4 py-3 text-white shadow-sm active:scale-95">
        <Icon name="puzzle" size={28} />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold">{t("new_module")}</span>
          <span className="block truncate text-xs text-white/80">{t("new_module_sub")}</span>
        </span>
        <span aria-hidden className="text-2xl">›</span>
      </Link>
      <Card>
        <h2 className="font-bold">{t("my_modules")}</h2>
        {mods.length === 0 ? <p className="mt-2 text-sm text-[var(--muted)]">{t("no_modules_yet")}</p> : (
          <ul className="mt-2 divide-y divide-black/5">
            {mods.map((m) => (
              <li key={m.id}>
                <Link href={`/teacher/module/?id=${m.id}`} className="flex items-center gap-2 py-2 text-sm active:opacity-60">
                  <span className="min-w-0 flex-1">
                    <span className="flex justify-between gap-2"><b className="truncate">{m.title}</b><Badge tone={m.price_model === "free" ? "green" : "blue"}>{priceText(m, t)}</Badge></span>
                    <span className="block text-xs text-[var(--muted)]">{t("module_stats", { e: m.enrolled, c: m.completed, s: inr(m.sales) })}</span>
                  </span>
                  <span aria-hidden className="text-lg text-[var(--muted)]">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {earn && (
        <Card>
          <h2 className="font-bold">{t("earnings")}</h2>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Stat label={t("module_sales")} value={inr(earn.sales_share)} />
            <Stat label={t("completions_label", { n: earn.completions })} value={inr(earn.completion_payouts)} />
            <Stat label={t("unpaid")} value={inr(earn.unpaid)} tone="text-[var(--good)]" />
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">{t("earnings_rule", { pct: Math.round(earn.share_of_sales * 100), p: inr(earn.payout_per_completion) })}</p>
          <button onClick={payOut} disabled={earn.unpaid <= 0} className="mt-2 w-full rounded-xl bg-[var(--brand)] py-2 font-semibold text-white disabled:opacity-40"> {t("pay_out")} {inr(earn.unpaid)}</button>
          <Link href="/teacher/payouts/" className="mt-2 block text-center text-sm font-semibold text-[var(--brand-ink)] underline">{t("module_view_payout")} →</Link>
          {payout && <p className="mt-2 text-xs">pain.001 {payout.msg_id} · <Mark kind={payout.validation.valid ? "yes" : "no"} size={14} /> {payout.validation.method}</p>}
        </Card>
      )}
    </>
  );
}

/** One of the teacher's own modules, as published: stats, lesson and quiz with the correct answers marked. */
export function TeacherModuleDetail({ id }: { id: number }) {
  const { t, authFetch } = useApp();
  const [mods, setMods] = useState<any[] | null>(null);
  useEffect(() => {
    authFetch("/api/modules/mine").then((r) => (r.ok ? r.json() : [])).then(setMods).catch(() => setMods([]));
  }, [authFetch]);
  if (mods === null) return <Card>…</Card>;
  const m = mods.find((x) => x.id === id);
  if (!m) return <Card>{t("module_not_found")}</Card>;
  return (
    <>
      <Card className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-bold leading-snug">{m.title}</h2>
          <Badge tone={m.price_model === "free" ? "green" : "blue"}>{priceText(m, t)}</Badge>
        </div>
        <div className="text-xs text-[var(--muted)]">
          {REGISTERED_LANGUAGES.find((language) => language.code === m.lang)?.nativeName ?? m.lang} · {t("module_published_on", { d: new Date(m.created_at * 1000).toLocaleDateString() })}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label={t("enrolled")} value={String(m.enrolled)} />
          <Stat label={t("completed")} value={String(m.completed)} />
          <Stat label={t("sales")} value={inr(m.sales)} />
        </div>
      </Card>
      <Card className="space-y-2">
        <h3 className="font-bold">{t("lesson")}</h3>
        <p className="whitespace-pre-line text-sm leading-relaxed">{m.lesson}</p>
        <SpeakButton text={m.lesson} />
      </Card>
      <Card>
        <h3 className="font-bold">❓ {t("quiz_with_answers", { n: m.quiz.length })}</h3>
        <ol className="mt-2 space-y-3 text-sm">
          {m.quiz.map((q: any, i: number) => (
            <li key={i}>
              <div className="font-medium">{i + 1}. {q.q}</div>
              <ul className="mt-1 space-y-1">
                {q.options.map((o: string, j: number) => (
                  <li key={j} className={`rounded-lg px-3 py-1.5 ${j === q.answer ? "bg-emerald-200 font-semibold text-black" : "bg-[var(--bg)]"}`}>
                    {j === q.answer && <><Mark kind="yes" size={14} /> </>}{o}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Card>
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
      <h2 className="font-bold">{t("mentor_connections")}</h2>
      <ul className="mt-2 divide-y divide-black/5 text-sm">
        {rows.map((r, i) => (
          <li key={i} className="py-1.5">{r.student.first_name || "—"} ({t("module_class_n", { n: r.student.class ?? "?" })}, {r.student.taluka ?? "?"}) → <b>{r.mentor}</b>
            <span className="text-xs text-[var(--muted)]"> · {new Date(r.at * 1000).toLocaleDateString()}</span></li>
        ))}
      </ul>
    </Card>
  );
}
