"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// The first minutes: one question per screen, big taps, no sign-up. The account (mobile number + PIN) comes after the
// first result, with a "Later" button. Everything the student taps becomes the profile the rest of the app uses.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { Shell, SpeakButton } from "@/components/ui";
import { computePlan, eligibility, inr, nearestCentres, rankCareers } from "@/lib/engine";
import { QUESTIONS } from "@/lib/questions";
import { API, LANGS, useApp, type AuthUser } from "@/lib/store";
import { setKV } from "@/lib/db";

type Step = "welcome" | "language" | "class" | "goal" | "marks" | "category" | "income" | "taluka" | "achieve" | "result" | "reminders" | "save";
const FLOW: Step[] = ["welcome", "language", "class", "goal", "marks", "category", "income", "taluka", "achieve", "result", "reminders", "save"];
const QUESTION_STEPS: Record<string, string> = { class: "class", category: "category", income: "family_income_annual", taluka: "taluka" };
// a marks band stands in for the exact percentage: the middle of the band
const MARKS: [string, number][] = [["marks_b1", 45], ["marks_b2", 55], ["marks_b3", 68], ["marks_b4", 82], ["marks_b5", 93]];
const GOALS: [string, string, string][] = [["career", "goal_career", "compass"], ["scholarship", "goal_scholarship", "rupee"], ["college", "goal_college", "school"]];
const ACHIEVE: [string, string][] = [["ach_1", "compass"], ["ach_2", "rupee"], ["ach_3", "school"], ["ach_4", "bell"]];

function Big({ children, onClick, on = false, icon }: { children: React.ReactNode; onClick: () => void; on?: boolean; icon?: string }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left text-base font-semibold ring-2 active:scale-[.98] ${on ? "bg-[var(--brand-soft)] text-[var(--brand-ink)] ring-[var(--brand)]" : "bg-[var(--card)] ring-black/10"}`}>
      {icon && <Icon name={icon} size={22} className="text-[var(--brand)]" />}<span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

function Primary({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className="w-full rounded-2xl bg-[var(--brand)] px-4 py-4 text-base font-bold text-white active:scale-[.98] disabled:opacity-40">{children}</button>;
}

function Start() {
  const { t, data, lang, setLang, setProfile, queueAction, signIn } = useApp();
  const router = useRouter();
  const [i, setI] = useState(0);
  const [p, setP] = useState<Record<string, any>>({ interests: [], documents: [], exams_passed: [] });
  const [goal, setGoal] = useState("career");
  const [channel, setChannel] = useState("app");
  const [freq, setFreq] = useState("important");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [under18, setUnder18] = useState(false);
  const [parentOk, setParentOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = FLOW[i];
  const next = (patch: Record<string, any> = {}) => { setP((x) => ({ ...x, ...patch })); setI((n) => Math.min(n + 1, FLOW.length - 1)); };
  const back = () => (i === 0 ? router.push("/login/") : setI(i - 1));

  const question = (key: string) => QUESTIONS.find((q) => q.key === key)!;
  const opts = (key: string) => (data ? question(key).options!(data, t, p) : []);

  // the first result, from the taps so far
  const result = useMemo(() => {
    if (step !== "result" || !data) return null;
    const prof = { ...p };
    const tk = data.talukas?.find((x: any) => x.name === p.taluka);
    if (tk) { prof.lat = tk.lat; prof.lon = tk.lon; }
    if (goal === "scholarship") return { kind: "scholarship" as const, list: eligibility(data, prof).filter((s: any) => s.status === "eligible" || s.status === "eligible_missing_docs").slice(0, 3) };
    if (goal === "college") return { kind: "college" as const, list: nearestCentres(data, prof, null, 3) };
    const top = rankCareers(data, prof, 1)[0];
    if (!top) return null;
    const plan = data.plans.find((x: any) => x.career_id === top.career.id);
    const r = plan ? computePlan(data, prof, plan.id) : null;
    const schol = plan ? eligibility(data, prof, plan).filter((s: any) => s.status === "eligible" || s.status === "eligible_missing_docs").length : 0;
    return { kind: "career" as const, career: top.career, r, schol };
  }, [step, data, p, goal]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const post = async (path: string, body: object) => {
        const r = await fetch(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json();
        if (!r.ok) throw Object.assign(new Error(typeof j.detail === "string" ? j.detail : j.detail?.[0]?.msg?.replace("Value error, ", "") ?? "Error"), { status: r.status });
        return j;
      };
      let existing = false;
      try { await post("/api/auth/register", { name, phone, pin, role: "student" }); }
      catch (e: any) { if (e?.status !== 409) throw e; existing = true; } // this number already has an account: sign in to it
      let j;
      try { j = await post("/api/auth/login", { phone, pin, role: "student" }); }
      catch (e: any) { throw existing ? new Error(t("start_exists_wrong_pin")) : e; }
      await signIn(j.access_token, j.user as AuthUser);
      if (existing) { await setKV("guest_profile", null); router.replace("/"); return; } // their saved profile stays as it is; the answers just given are not added over it
      const tk = data?.talukas?.find((x: any) => x.name === p.taluka);
      const merged = { ...p, name, ...(tk ? { lat: tk.lat, lon: tk.lon } : {}), reminder_channel: channel, reminder_frequency: freq };
      setProfile(merged);
      await queueAction("profile", merged);
      if (under18 && parentOk) {
        await queueAction("consent", { purpose: "Career guidance and scholarship matching", student: name, by: "Parent or guardian, confirmed by the student", at: new Date().toISOString(), lawful_basis: "DPDP Act 2023, verifiable parental consent for a child" });
      }
      await setKV("guest_profile", null);
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const phoneOk = phone.length === 10, pinOk = pin.length >= 4, nameOk = name.trim().length >= 2;
  const canSave = phoneOk && pinOk && nameOk && (!under18 || parentOk);
  const head = (title: string, hint?: string) => (
    <div className="space-y-1">
      <h2 className="text-2xl font-extrabold leading-tight text-[var(--brand-ink)]">{title}</h2>
      {hint && <p className="text-sm text-[var(--muted)]">{hint}</p>}
    </div>
  );
  const qHead = (key: string) => { const a = question(key).ask(t, p); return head(a.text, a.hint); };

  return (
    <div className="flex min-h-[70dvh] flex-col gap-4">
      {step !== "welcome" && (
        <div className="flex items-center gap-3">
          <button onClick={back} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full bg-[var(--card)] ring-1 ring-black/10"><Icon name="arrowright" size={18} className="rotate-180" /></button>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/10" role="progressbar" aria-valuemin={1} aria-valuemax={FLOW.length - 1} aria-valuenow={i}>
            <div className="h-full rounded-full bg-[var(--brand)] transition-all" style={{ width: `${(i / (FLOW.length - 1)) * 100}%` }} />
          </div>
        </div>
      )}

      {step === "welcome" && (
        <div className="flex flex-1 flex-col justify-center gap-6 text-center">
          <Icon name="compass" size={64} className="mx-auto text-[var(--brand)]" />
          <div>
            <h1 className="text-3xl font-extrabold text-[var(--brand-ink)]">{t("app_name")}</h1>
            <p className="mt-2 text-base text-[var(--muted)]">{t("tagline")}</p>
          </div>
          <div className="space-y-2">
            <Primary onClick={() => setI(1)}>{t("start_get_started")}</Primary>
            <Link href="/login/" className="block w-full rounded-2xl border-2 border-black/15 py-3.5 text-base font-bold active:scale-[.98]">{t("start_have_account")}</Link>
          </div>
        </div>
      )}

      {step === "language" && (
        <>
          {head(t("choose_language"))}
          <div className="space-y-2">
            {LANGS.map((l) => (
              <div key={l.code} className="flex items-center gap-2">
                <div className="flex-1"><Big on={lang === l.code} onClick={() => { setLang(l.code); next(); }}>{l.label}</Big></div>
                <SpeakButton text={l.label} lang={l.code} label={t("play")} />
              </div>
            ))}
          </div>
        </>
      )}

      {step === "class" && (
        <>
          {qHead("class")}
          <div className="grid grid-cols-2 gap-2">{opts("class").map((o: any) => <Big key={o.label} on={p.class === o.v} onClick={() => next({ class: o.v })}>{o.label}</Big>)}</div>
        </>
      )}

      {step === "goal" && (
        <>
          {head(t("start_q_goal"))}
          <div className="space-y-2">{GOALS.map(([k, label, icon]) => <Big key={k} icon={icon} on={goal === k} onClick={() => { setGoal(k); next(); }}>{t(label)}</Big>)}</div>
        </>
      )}

      {step === "marks" && (
        <>
          {head(t("start_q_marks"), t("start_q_marks_hint"))}
          <div className="space-y-2">
            {MARKS.map(([k, v]) => <Big key={k} on={p.marks_pct === v} onClick={() => next({ marks_pct: v })}>{t(k)}</Big>)}
            <Big onClick={() => next({ marks_exam: "unknown" })}>{t("opt_dont_remember")}</Big>
          </div>
        </>
      )}

      {(step === "category" || step === "income") && (
        <>
          {qHead(QUESTION_STEPS[step])}
          <div className={step === "category" ? "grid grid-cols-2 gap-2" : "space-y-2"}>
            {opts(QUESTION_STEPS[step]).map((o: any) => <Big key={o.label} on={p[QUESTION_STEPS[step]] === o.v} onClick={() => next({ [QUESTION_STEPS[step]]: o.v })}>{o.label}</Big>)}
          </div>
        </>
      )}

      {step === "taluka" && (
        <>
          {qHead("taluka")}
          <div className="grid grid-cols-2 gap-2">{opts("taluka").map((o: any) => <Big key={o.label} on={p.taluka === o.v} onClick={() => next({ taluka: o.v })}>{o.label}</Big>)}</div>
        </>
      )}

      {step === "achieve" && (
        <>
          {head(t("start_achieve_title"))}
          <ul className="space-y-2">
            {ACHIEVE.map(([k, icon]) => (
              <li key={k} className="flex items-center gap-3 rounded-2xl bg-[var(--card)] p-4 ring-1 ring-black/10"><Icon name={icon} size={22} className="text-[var(--brand)]" /><span className="text-base font-medium">{t(k)}</span></li>
            ))}
          </ul>
          <div className="mt-auto"><Primary onClick={() => next()}>{t("continue")}</Primary></div>
        </>
      )}

      {step === "result" && (
        <>
          {head(t("start_result_title"))}
          {!result && <p className="rounded-2xl bg-[var(--card)] p-4 text-sm ring-1 ring-black/10">{t("start_result_none")}</p>}
          {result?.kind === "career" && (
            <div className="space-y-3 rounded-2xl bg-[var(--card)] p-4 ring-2 ring-[var(--brand)]">
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">{t("start_best_match")}</div>
              <div className="text-2xl font-extrabold">{result.career.name}</div>
              {result.r && (
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl bg-[var(--bg)] p-3"><dt className="text-xs text-[var(--muted)]">{t("total_cost")}</dt><dd className="text-lg font-bold">{inr(result.r.costs.total)}</dd></div>
                  <div className="rounded-xl bg-[var(--bg)] p-3"><dt className="text-xs text-[var(--muted)]">{t("start_after_aid")}</dt><dd className="text-lg font-bold">{inr(result.r.net_cost)}</dd></div>
                  <div className="rounded-xl bg-[var(--bg)] p-3"><dt className="text-xs text-[var(--muted)]">{t("start_scholarships")}</dt><dd className="text-lg font-bold">{result.schol}</dd></div>
                  <div className="rounded-xl bg-[var(--bg)] p-3"><dt className="text-xs text-[var(--muted)]">{t("payback")}</dt><dd className="text-lg font-bold">{result.r.payback?.median?.months_after_training != null ? t(result.r.payback.median.months_after_training === 1 ? "start_month" : "start_months", { n: result.r.payback.median.months_after_training }) : "—"}</dd></div>
                </dl>
              )}
              <p className="text-xs text-[var(--muted)]">{t("start_estimates_note")}</p>
            </div>
          )}
          {result?.kind === "scholarship" && (
            <ul className="space-y-2">{result.list.length ? result.list.map((s: any) => (
              <li key={s.id} className="rounded-2xl bg-[var(--card)] p-4 ring-1 ring-black/10"><div className="font-bold">{s.name}</div><div className="text-xs text-[var(--muted)]">{s.amount_text}</div></li>
            )) : <li className="rounded-2xl bg-[var(--card)] p-4 text-sm ring-1 ring-black/10">{t("start_result_none")}</li>}</ul>
          )}
          {result?.kind === "college" && (
            <ul className="space-y-2">{result.list.map((c: any) => (
              <li key={c.id} className="rounded-2xl bg-[var(--card)] p-4 ring-1 ring-black/10"><div className="font-bold">{c.name}</div><div className="text-xs text-[var(--muted)]">{c.type}{c.distance_km != null ? ` · ${c.distance_km} km` : ""}</div></li>
            ))}</ul>
          )}
          <div className="mt-auto space-y-2">
            <Primary onClick={() => next(result?.kind === "career" ? { roadmap_career: result.career.id, roadmap_at: new Date().toISOString() } : {})}>
              {result?.kind === "career" ? t("start_this_path") : t("continue")}
            </Primary>
            {result?.kind === "career" && <button onClick={() => next()} className="w-full py-2 text-sm font-semibold text-[var(--brand-ink)] underline">{t("start_not_now")}</button>}
          </div>
        </>
      )}

      {step === "reminders" && (
        <>
          {head(t("start_reminders_title"), t("start_reminders_hint"))}
          <div className="space-y-2">
            {([["app", "ch_app", "bell"], ["sms", "ch_sms", "chat"], ["whatsapp", "ch_whatsapp", "send"]] as const).map(([k, label, icon]) => <Big key={k} icon={icon} on={channel === k} onClick={() => setChannel(k)}>{t(label)}</Big>)}
          </div>
          <div className="space-y-2">
            {([["important", "freq_important"], ["weekly", "freq_weekly"]] as const).map(([k, label]) => <Big key={k} on={freq === k} onClick={() => setFreq(k)}>{t(label)}</Big>)}
          </div>
          <div className="mt-auto"><Primary onClick={() => next()}>{t("continue")}</Primary></div>
        </>
      )}

      {step === "save" && (
        <>
          {head(t("start_save_title"), t("start_save_hint"))}
          <div className="space-y-3">
            <label className="block text-sm"><span className="text-[var(--muted)]">{t("full_name")}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} className="mt-1 w-full rounded-xl bg-[var(--card)] p-3 text-lg ring-1 ring-black/10" /></label>
            <label className="block text-sm"><span className="text-[var(--muted)]">{t("phone")}</span>
              <div className="mt-1 flex items-center rounded-xl bg-[var(--card)] px-3 ring-1 ring-black/10"><span className="text-[var(--muted)]">+91</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" autoComplete="tel" className="w-full bg-transparent p-3 text-lg tracking-wider outline-none" /></div></label>
            <label className="block text-sm"><span className="text-[var(--muted)]">{t("pin")}</span>
              <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" type="password" autoComplete="new-password"
                className="mt-1 w-full rounded-xl bg-[var(--card)] p-3 text-center text-2xl tracking-[0.5em] ring-1 ring-black/10" /></label>
            <p className="text-xs text-[var(--muted)]">{t("pin_hint")}</p>
            <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={under18} onChange={(e) => { setUnder18(e.target.checked); if (!e.target.checked) setParentOk(false); }} className="h-5 w-5" />{t("start_under18")}</label>
            {under18 && <label className="flex items-start gap-3 rounded-xl bg-[var(--brand-soft)] p-3 text-sm"><input type="checkbox" checked={parentOk} onChange={(e) => setParentOk(e.target.checked)} className="mt-0.5 h-5 w-5" />{t("start_parent_ok")}</label>}
            {error && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{error}</p>}
          </div>
          <div className="mt-auto space-y-2">
            <Primary onClick={save} disabled={busy || !canSave}>{t("create_account")}</Primary>
            <button onClick={() => setI(FLOW.indexOf("result"))} className="w-full py-2 text-sm font-semibold text-[var(--brand-ink)] underline">{t("start_later")}</button>
            <p className="text-center text-[11px] text-[var(--muted)]">{t("start_later_note")}</p>
          </div>
        </>
      )}
    </div>
  );
}

export default function StartPage() {
  const { t } = useApp();
  return (
    <Shell title={t("app_name")} back={null} publicPage>
      <Start />
    </Shell>
  );
}

