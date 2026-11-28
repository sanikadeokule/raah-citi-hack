"use client";
// Parent / family dashboard (Raah Pro). The student sets a family PIN; a parent enters
// the student's mobile + that PIN and gets a read-only view of roadmap, exams, lessons
// and notifications. The page holds its own auth state: it never touches the main
// useApp() store (which belongs to the signed-in student).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { Badge, Card, Shell, SpeakButton } from "@/components/ui";
import { API, useApp } from "@/lib/store";
import { languageName } from "@/lib/languages";

/** Parent-mode text lives in the locale files under the pm_ prefix. */
function usePm() {
  const { t } = useApp();
  return (k: string, vars?: Record<string, string | number>) => t(`pm_${k}`, vars);
}

const FAMILY_TOKEN_KEY = "raah_family_token";

function timeAgo(ts: number) {
  const diff = Math.floor((Date.now() / 1000 - ts) / 60);
  if (diff < 2) return "just now";
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
}

function SignInForm({ onToken }: { onToken: (tok: string, name: string) => void }) {
  const t = usePm();
  const { t: globalT } = useApp();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/api/parent/token`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), family_pin: pin }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.detail === "no student found or family PIN not set" ? t("no_pin") : t("wrong"));
        return;
      }
      const j = await r.json();
      try { localStorage.setItem(FAMILY_TOKEN_KEY, j.access_token); } catch {}
      onToken(j.access_token, j.student_name);
    } catch {
      setErr(t("wrong"));
    } finally { setBusy(false); }
  }

  return (
    <Card className="max-w-sm mx-auto">
      <h2 className="font-bold text-lg">{t("sign_in")}</h2>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <label className="block text-sm">
          <span className="text-(--muted)">{t("phone")}</span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required maxLength={12}
            className="mt-1 w-full rounded-lg bg-(--bg) p-2 text-sm" placeholder={globalT("family_phone_hint")} />
        </label>
        <label className="block text-sm">
          <span className="text-(--muted)">{t("pin")}</span>
          <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} required maxLength={8}
            className="mt-1 w-full rounded-lg bg-(--bg) p-2 text-sm" placeholder={globalT("family_pin_hint")} />
        </label>
        {err && <p className="rounded-xl bg-rose-50 p-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-200">{err}</p>}
        <button type="submit" disabled={busy}
          className="w-full rounded-xl bg-(--brand) py-3 font-semibold text-white disabled:opacity-60">
          {busy ? t("signing_in") : t("sign_in_btn")}
        </button>
      </form>
    </Card>
  );
}

function PinManager({ studentToken }: { studentToken: string }) {
  const t = usePm();
  const [newPin, setNewPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    if (!newPin.match(/^\d{4,8}$/)) return;
    setBusy(true); setMsg("");
    const r = await fetch(`${API}/api/parent/set-pin`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({ family_pin: newPin }),
    });
    setBusy(false);
    setMsg(r.ok ? t("pin_saved") : t("pin_save_error"));
  }

  async function remove() {
    setBusy(true);
    await fetch(`${API}/api/parent/pin`, { method: "DELETE", headers: { Authorization: `Bearer ${studentToken}` } });
    setBusy(false); setMsg(t("pin_saved"));
  }

  return (
    <Card className="border border-amber-300 bg-amber-50 dark:bg-amber-900/20">
      <h3 className="font-bold text-sm">{t("pin_set_title")}</h3>
      <p className="text-xs text-(--muted) mt-0.5">{t("pin_set_sub")}</p>
      <div className="mt-3 flex gap-2">
        <input type="password" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(e.target.value)}
          maxLength={8} placeholder={t("new_pin")}
          className="flex-1 rounded-lg bg-(--bg) p-2 text-sm" />
        <button onClick={save} disabled={busy || !newPin.match(/^\d{4,8}$/)}
          className="rounded-lg bg-(--brand) px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? t("saving") : t("save_pin")}
        </button>
      </div>
      {msg && <p className="mt-1 text-xs text-(--good)">{msg}</p>}
      <button onClick={remove} disabled={busy} className="mt-2 text-xs text-rose-500 underline">{t("remove_pin")}</button>
    </Card>
  );
}

function Dashboard({ token, studentName, onSignOut, onExpired }: { token: string; studentName: string; onSignOut: () => void; onExpired: () => void }) {
  const t = usePm();
  const { lang, t: globalT } = useApp();
  const [data, setData] = useState<any>(null);
  const [askError, setAskError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<any>(null);
  const [asking, setAsking] = useState(false);
  const [plan, setPlan] = useState<any>(undefined);
  const hdr = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetch(`${API}/api/parent/plan-card`, { headers: hdr }).then((r) => r.ok ? r.json() : null).then((j) => setPlan(j?.plan ?? null)).catch(() => setPlan(null));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function agree(id: number) {
    const r = await fetch(`${API}/api/parent/applications/${id}/agree`, { method: "POST", headers: hdr });
    if (r.ok) { const j = await r.json(); setData((d: any) => ({ ...d, applications: d.applications.map((a: any) => a.id === id ? { ...a, parent_agreed_at: j.parent_agreed_at } : a) })); }
  }

  useEffect(() => {
    fetch(`${API}/api/parent/summary`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : r.json().then((j: any) => Promise.reject(j)))
      .then(setData)
      .catch(() => onExpired());
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ask(e: React.FormEvent | null, preset?: string) {
    e?.preventDefault();
    const q = (preset ?? question).trim();
    if (!q) return;
    if (preset) setQuestion(preset);
    setAsking(true); setAskError(""); setAnswer(null);
    try {
      const r = await fetch(`${API}/api/parent/ask`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: q, lang }),
      });
      if (!r.ok) throw new Error("parent question failed");
      setAnswer(await r.json());
    } catch { setAskError(t("ask_error")); }
    finally { setAsking(false); }
  }

  if (!data) return <div className="py-16 text-center text-sm text-(--muted)">{globalT("loading")}</div>;

  const name = data.student_name || studentName;
  const waiting = (data.applications ?? []).filter((a: any) => a.student_approved_message && !a.parent_agreed_at);
  return (
    <div className="xl:space-y-4">
      {waiting.length > 0 && (
        <Card className="border-2 border-(--brand)">
          <h3 className="font-bold">{t("waiting_for_you")}</h3>
          <ul className="mt-2 space-y-2">{waiting.map((app: any, i: number) => (
            <li key={`${app.title}-${i}`} className="rounded-xl bg-(--brand-soft) p-3 text-sm">
              <b>{app.title}</b>
              <p className="mt-2 border-t border-black/10 pt-2 text-(--muted)"><b>{t("student_message")}:</b> {app.student_approved_message}</p>
              <button onClick={() => agree(app.id)} className="mt-2 w-full rounded-xl bg-(--brand) py-2.5 text-sm font-semibold text-white">{t("agree")}</button>
            </li>))}</ul>
        </Card>
      )}
      <div className="space-y-4 xl:grid xl:grid-cols-2 xl:items-start xl:gap-4 xl:space-y-0">
      <div className="space-y-4">
      <Card className="!bg-linear-to-br from-(--brand) to-[#0f2547] text-white">
        <div className="text-sm text-white/70">{t("welcome")}</div>
        <div className="mt-1 text-2xl font-extrabold leading-tight">{name}</div>
        <details className="group mt-3 rounded-xl bg-white/10 p-2.5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
            <span>
              <span className="block text-[11px] text-white/70">{t("career")}</span>
              <span className="block text-sm font-semibold leading-snug">{data.career?.name || t("not_set")}</span>
            </span>
            {data.career && <span aria-hidden className="text-lg transition-transform group-open:rotate-90">›</span>}
          </summary>
          {data.career && (
            <dl className="mt-2 space-y-1.5 border-t border-white/15 pt-2 text-xs">
              {([["category", data.career.category], ["entry", data.career.entry_path], ["qual", data.career.min_qualification], ["income", data.career.income]] as const)
                .filter(([, v]) => v).map(([k, v]) => (
                  <div key={k}><dt className="text-white/60">{t(`c_${k}`)}</dt><dd className="font-medium">{v}</dd></div>))}
            </dl>
          )}
        </details>
        {data.roadmap_at && (
          <div className="mt-2 rounded-xl bg-white/10 p-2.5">
            <div className="text-[11px] text-white/70">{t("stage")}</div>
            <div className="text-sm font-semibold">{t("chosen_on")} {new Date(data.roadmap_at).toLocaleDateString()}</div>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="font-bold">{t("applications")}</h3>
        {!data.applications?.length
          ? <p className="mt-2 text-sm text-(--muted)">{t("no_apps")}</p>
          : <ul className="mt-2 space-y-2">{data.applications.map((app: any, i: number) => (
              <li key={`${app.title}-${i}`} className="rounded-xl bg-(--bg) p-3 text-sm">
                <div className="flex items-start justify-between gap-2"><b>{app.title}</b><Badge tone="blue">{t(`stage_${app.stage}`)}</Badge></div>
                {app.student_approved_message && <p className="mt-2 border-t border-black/10 pt-2 text-(--muted)"><b>{t("student_message")}:</b> {app.student_approved_message}</p>}
                {app.student_approved_message && (app.parent_agreed_at
                  ? <p className="mt-2 text-xs font-semibold text-(--good)">{t("agreed")}</p>
                  : <button onClick={() => agree(app.id)} className="mt-2 w-full rounded-xl bg-(--brand) py-2.5 text-sm font-semibold text-white">{t("agree")}</button>)}
              </li>))}</ul>}
      </Card>

      <Card className="space-y-3">
        <h3 className="font-bold">{t("quick")}</h3>
        <div className="flex flex-wrap gap-2">
          {[["q_month", "How much per month will this cost us?"], ["q_total", "What is the total cost of this course?"], ["q_schol", "Are there scholarships that cover this?"]].map(([k, q]) => (
            <button key={k} onClick={() => ask(null, q)} disabled={asking} className="rounded-full bg-(--bg) px-3 py-1.5 text-sm font-medium ring-1 ring-black/10 disabled:opacity-50">{t(k)}</button>))}
        </div>
        {plan === null && <p className="text-sm text-(--muted)">{t("no_plan")}</p>}
        {plan && (
          <div className="rounded-xl bg-(--bg) p-3">
            <p className="text-xs text-(--muted)">{t("path_picked")}: <b>{plan.label}</b></p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-xs text-(--muted)">{t("per_month")}</dt><dd className="font-bold">₹{plan.per_month.toLocaleString("en-IN")}</dd></div>
              <div><dt className="text-xs text-(--muted)">{t("total_cost")}</dt><dd className="font-bold">₹{plan.total.toLocaleString("en-IN")}</dd></div>
              <div><dt className="text-xs text-(--muted)">{t("scholarship")}</dt><dd className="font-bold">₹{plan.scholarship.toLocaleString("en-IN")}</dd></div>
              <div><dt className="text-xs text-(--muted)">{t("paid_back")}</dt><dd className="font-bold">{plan.payback_months != null ? t("months", { n: plan.payback_months }) : "-"}</dd></div>
            </dl>
          </div>)}
      </Card>
      </div>

      <div className="space-y-4">
      <Card>
        <h3 className="font-bold">{t("ask_title")}</h3>
        <p className="mt-1 text-xs text-(--muted)">{t("ask_hint")}</p>
        <form onSubmit={(e) => ask(e)} className="mt-3 space-y-2">
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} maxLength={500}
            placeholder={t("ask_placeholder")} aria-label={t("ask_title")} className="w-full rounded-lg bg-(--bg) p-3 text-sm" />
          <button disabled={asking || !question.trim()} className="w-full rounded-xl bg-(--brand) py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {asking ? t("asking") : t("ask_btn")}
          </button>
        </form>
        {answer && <div aria-live="polite" className="mt-3 rounded-xl bg-(--bg) p-3 text-sm leading-relaxed">
          <p>{answer.answer}</p>
          <div className="mt-2"><SpeakButton text={answer.answer} lang={lang} label={t("listen", { lang: languageName(lang) })} /></div>
          {answer.citations?.length > 0 && <div className="mt-2 border-t border-black/10 pt-2 text-xs text-(--muted)">
            {answer.citations.map((c: any) => c.source && <a key={`${c.n}-${c.source}`} className="mr-2 underline" href={c.source} target="_blank" rel="noreferrer">[{c.n}] {c.title}</a>)}
          </div>}
        </div>}
        {askError && <p role="alert" className="mt-2 text-sm text-rose-600">{askError}</p>}
      </Card>

      <Card>
        <h3 className="font-bold">{t("exams")}</h3>
        {!data.watched_exams.length
          ? <p className="mt-2 text-sm text-(--muted)">{t("no_exams")}</p>
          : <ul className="mt-2 space-y-1">{data.watched_exams.map((id: string) => (
              <li key={id} className="flex items-center gap-2 rounded-xl bg-(--bg) px-3 py-2 text-sm">
                <span className="text-base"></span><span className="font-medium">{id}</span>
              </li>))}</ul>}
      </Card>

      <Card>
        <h3 className="font-bold">{t("lessons")}</h3>
        {!data.lessons_done.length
          ? <p className="mt-2 text-sm text-(--muted)">{t("no_lessons")}</p>
          : <ul className="mt-2 space-y-1 text-sm">{data.lessons_done.slice(0, 10).map((l: any, i: number) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded-xl bg-(--bg) px-3 py-2">
                <span className="font-medium">{l.subject || l.id || t("subject")}</span>
                <span className="text-[11px] text-(--muted)">{l.received_at ? timeAgo(l.received_at) : ""}</span>
              </li>))}</ul>}
      </Card>

      <Card>
        <h3 className="font-bold">{t("notifications")}</h3>
        {!data.notifications.length
          ? <p className="mt-2 text-sm text-(--muted)">{t("no_notifs")}</p>
          : <ul className="mt-2 space-y-1 text-sm">{data.notifications.slice(0, 8).map((n: any) => (
              <li key={n.id} className="rounded-xl bg-(--bg) px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{n.title || n.kind}</span>
                  <span className="shrink-0 text-[11px] text-(--muted)">{timeAgo(n.created_at)}</span>
                </div>
                {n.body && <p className="mt-0.5 text-xs text-(--muted)">{n.body}</p>}
              </li>))}</ul>}
      </Card>
      </div>
      </div>

      <button onClick={onSignOut} className="mt-2 w-full rounded-xl bg-(--bg) py-3 text-sm font-semibold text-(--muted)">
        {t("sign_out")}
      </button>
    </div>
  );
}

export default function ParentPage() {
  const t = usePm();
  const { auth } = useApp();
  const [familyToken, setFamilyToken] = useState<string | null>(null);
  const [studentName, setStudentName] = useState("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    try { const s = localStorage.getItem(FAMILY_TOKEN_KEY); if (s) setFamilyToken(s); } catch {}
  }, []);

  function signOut() {
    try { localStorage.removeItem(FAMILY_TOKEN_KEY); } catch {}
    setFamilyToken(null); setStudentName("");
  }

  return (
    <Shell title={t("title")} publicPage wide>
      {familyToken
        ? <Dashboard token={familyToken} studentName={studentName} onSignOut={signOut} onExpired={() => { signOut(); setExpired(true); }} />
        : <>
            {auth?.token && auth.user.role === "student" && (
              <div className="mb-2">
                <p className="mb-1 px-1 text-xs font-semibold text-(--muted)">{t("for_student")}</p>
                <PinManager studentToken={auth.token} />
              </div>
            )}
            {expired && <p className="mb-2 rounded-xl bg-amber-50 p-2 text-sm text-amber-900">{t("expired")}</p>}
            <SignInForm onToken={(tok, name) => { setExpired(false); setFamilyToken(tok); setStudentName(name); }} />
          </>}
    </Shell>
  );
}
