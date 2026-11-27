"use client";
// Parent / family dashboard (Raah Pro). The student sets a family PIN; a parent enters
// the student's mobile + that PIN and gets a read-only view of roadmap, exams, lessons
// and notifications. The page holds its own auth state: it never touches the main
// useApp() store (which belongs to the signed-in student).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { Badge, Card, Shell } from "@/components/ui";
import { useText } from "@/components/pro";
import { API, useApp } from "@/lib/store";

const T: Record<string, Record<string, string>> = {
  en: {
    title: "Family view", sign_in: "Sign in as parent / guardian",
    phone: "Student's mobile number", pin: "Family PIN", sign_in_btn: "View dashboard",
    signing_in: "Signing in…", wrong: "Wrong number or PIN. Ask your student to set a family PIN in their app.",
    no_pin: "No family PIN is set on this account. Ask the student to set one from the app.",
    welcome: "Welcome, family of", career: "Career goal", stage: "Roadmap stage",
    not_set: "Not set yet", exams: "Watched exams", no_exams: "No exams tracked yet",
    lessons: "Recent lessons", no_lessons: "No lessons yet", subject: "Subject",
    when: "When", notifications: "Notifications", no_notifs: "No new notifications",
    applications: "Scholarship applications", no_apps: "No applications are being tracked yet.",
    ask_title: "Ask Raah about the costs", ask_hint: "Ask in English, Hindi, or Marathi. Raah uses the student's profile and verified data.",
    ask_placeholder: "Can we afford this course?", ask_btn: "Ask", asking: "Checking…", ask_error: "Could not get an answer. Please try again.",
    stage_researching: "Preparing", stage_docs_submitted: "Documents submitted", stage_applied: "Applied", stage_waiting: "Waiting", stage_result: "Result received",
    student_message: "Message approved by the student",
    sign_out: "Sign out",
    pin_set_title: "Set your family PIN", pin_set_sub: "Let a parent or guardian see your progress. Choose a 4–8 digit PIN they will enter on this page.",
    new_pin: "New family PIN (4–8 digits)", save_pin: "Save PIN", saving: "Saving…", pin_saved: "PIN saved!",
    remove_pin: "Remove PIN",
    for_student: "For the student — set a family PIN",
    expired: "Your family session ended. Please sign in again with the same number and PIN.", c_category: "Type of work", c_entry: "How to get in", c_qual: "Minimum qualification", c_income: "Expected income", chosen_on: "Chosen on",
  },
  hi: {
    title: "परिवार दृश्य", sign_in: "अभिभावक के रूप में साइन इन करें",
    phone: "छात्र का मोबाइल नंबर", pin: "फैमिली PIN", sign_in_btn: "डैशबोर्ड देखें",
    signing_in: "साइन इन हो रहे हैं…", wrong: "नंबर या PIN गलत है। छात्र से फैमिली PIN सेट करने को कहें।",
    no_pin: "इस खाते पर फैमिली PIN नहीं है। छात्र से ऐप में सेट करने को कहें।",
    welcome: "परिवार में आपका स्वागत,", career: "करियर लक्ष्य", stage: "रोडमैप चरण",
    not_set: "अभी तय नहीं", exams: "देखी जा रही परीक्षाएँ", no_exams: "कोई परीक्षा ट्रैक नहीं",
    lessons: "हाल के पाठ", no_lessons: "अभी कोई पाठ नहीं", subject: "विषय",
    when: "कब", notifications: "सूचनाएँ", no_notifs: "नई सूचना नहीं",
    applications: "छात्रवृत्ति आवेदन", no_apps: "अभी कोई आवेदन ट्रैक नहीं हो रहा है।",
    ask_title: "खर्च के बारे में Raah से पूछें", ask_hint: "हिंदी, मराठी या अंग्रेज़ी में पूछें। Raah छात्र की प्रोफ़ाइल और सत्यापित जानकारी देखेगा।",
    ask_placeholder: "क्या हम इस कोर्स का खर्च उठा सकते हैं?", ask_btn: "पूछें", asking: "जाँच रहे हैं…", ask_error: "जवाब नहीं मिला। फिर से कोशिश करें।",
    stage_researching: "तैयारी", stage_docs_submitted: "दस्तावेज़ जमा", stage_applied: "आवेदन किया", stage_waiting: "प्रतीक्षा", stage_result: "नतीजा मिला",
    student_message: "छात्र की मंज़ूरी वाला संदेश",
    sign_out: "साइन आउट",
    pin_set_title: "फैमिली PIN सेट करें", pin_set_sub: "माता-पिता को प्रगति देखने दें। 4–8 अंकों का PIN चुनें।",
    new_pin: "नया फैमिली PIN (4–8 अंक)", save_pin: "PIN सेव करें", saving: "सेव हो रहा है…", pin_saved: "PIN सेव हुआ!",
    remove_pin: "PIN हटाएँ",
    for_student: "छात्र के लिए — फैमिली PIN सेट करें",
    expired: "आपका सत्र खत्म हो गया। उसी नंबर और PIN से फिर साइन इन करें।", c_category: "काम का प्रकार", c_entry: "कैसे प्रवेश करें", c_qual: "न्यूनतम योग्यता", c_income: "अपेक्षित आय", chosen_on: "चुना गया:",
  },
  mr: {
    title: "कुटुंब दृश्य", sign_in: "पालक म्हणून साइन इन करा",
    phone: "विद्यार्थ्याचा मोबाइल नंबर", pin: "कुटुंब PIN", sign_in_btn: "डॅशबोर्ड पाहा",
    signing_in: "साइन इन होत आहे…", wrong: "नंबर किंवा PIN चुकीचा. विद्यार्थ्याला कुटुंब PIN सेट करायला सांगा.",
    no_pin: "या खात्यावर कुटुंब PIN नाही. विद्यार्थ्याला ॲपमध्ये सेट करायला सांगा.",
    welcome: "कुटुंबाचे स्वागत,", career: "करिअर ध्येय", stage: "रोडमॅप टप्पा",
    not_set: "अजून ठरलेले नाही", exams: "पाहिलेल्या परीक्षा", no_exams: "कोणत्याही परीक्षा ट्रॅक केल्या नाहीत",
    lessons: "अलीकडील धडे", no_lessons: "अजून धडे नाहीत", subject: "विषय",
    when: "केव्हा", notifications: "सूचना", no_notifs: "नवीन सूचना नाही",
    applications: "शिष्यवृत्ती अर्ज", no_apps: "अद्याप कोणतेही अर्ज ट्रॅक होत नाहीत.",
    ask_title: "खर्चाविषयी Raah ला विचारा", ask_hint: "मराठी, हिंदी किंवा इंग्रजीत विचारा. Raah विद्यार्थ्याची प्रोफाइल आणि पडताळलेली माहिती वापरेल.",
    ask_placeholder: "आपल्याला या अभ्यासक्रमाचा खर्च परवडेल का?", ask_btn: "विचारा", asking: "तपासत आहे…", ask_error: "उत्तर मिळाले नाही. पुन्हा प्रयत्न करा.",
    stage_researching: "तयारी", stage_docs_submitted: "कागदपत्रे जमा", stage_applied: "अर्ज केला", stage_waiting: "प्रतीक्षा", stage_result: "निकाल मिळाला",
    student_message: "विद्यार्थ्याने मंजूर केलेला संदेश",
    sign_out: "साइन आउट",
    pin_set_title: "कुटुंब PIN सेट करा", pin_set_sub: "पालकांना तुमची प्रगती पाहू द्या. 4–8 अंकांचा PIN निवडा.",
    new_pin: "नवीन कुटुंब PIN (4–8 अंक)", save_pin: "PIN सेव करा", saving: "सेव होत आहे…", pin_saved: "PIN सेव झाला!",
    remove_pin: "PIN काढा",
    for_student: "विद्यार्थ्यासाठी — कुटुंब PIN सेट करा",
    expired: "तुमचे सत्र संपले. त्याच नंबर आणि PIN ने पुन्हा साइन इन करा.", c_category: "कामाचा प्रकार", c_entry: "कसा प्रवेश मिळवावा", c_qual: "किमान पात्रता", c_income: "अपेक्षित उत्पन्न", chosen_on: "निवडले:",
  },
};

const FAMILY_TOKEN_KEY = "raah_family_token";

function timeAgo(ts: number) {
  const diff = Math.floor((Date.now() / 1000 - ts) / 60);
  if (diff < 2) return "just now";
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
}

function SignInForm({ onToken }: { onToken: (tok: string, name: string) => void }) {
  const t = useText(T);
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
          <span className="text-[var(--muted)]">{t("phone")}</span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required maxLength={12}
            className="mt-1 w-full rounded-lg bg-[var(--bg)] p-2 text-sm" placeholder="10-digit number" />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("pin")}</span>
          <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} required maxLength={8}
            className="mt-1 w-full rounded-lg bg-[var(--bg)] p-2 text-sm" placeholder="4–8 digits" />
        </label>
        {err && <p className="rounded-xl bg-rose-50 p-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-200">{err}</p>}
        <button type="submit" disabled={busy}
          className="w-full rounded-xl bg-[var(--brand)] py-3 font-semibold text-white disabled:opacity-60">
          {busy ? t("signing_in") : t("sign_in_btn")}
        </button>
      </form>
    </Card>
  );
}

function PinManager({ studentToken }: { studentToken: string }) {
  const t = useText(T);
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
    setMsg(r.ok ? t("pin_saved") : "Error saving");
  }

  async function remove() {
    setBusy(true);
    await fetch(`${API}/api/parent/pin`, { method: "DELETE", headers: { Authorization: `Bearer ${studentToken}` } });
    setBusy(false); setMsg(t("pin_saved"));
  }

  return (
    <Card className="border border-amber-300 bg-amber-50 dark:bg-amber-900/20">
      <h3 className="font-bold text-sm">{t("pin_set_title")}</h3>
      <p className="text-xs text-[var(--muted)] mt-0.5">{t("pin_set_sub")}</p>
      <div className="mt-3 flex gap-2">
        <input type="password" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(e.target.value)}
          maxLength={8} placeholder={t("new_pin")}
          className="flex-1 rounded-lg bg-[var(--bg)] p-2 text-sm" />
        <button onClick={save} disabled={busy || !newPin.match(/^\d{4,8}$/)}
          className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? t("saving") : t("save_pin")}
        </button>
      </div>
      {msg && <p className="mt-1 text-xs text-[var(--good)]">{msg}</p>}
      <button onClick={remove} disabled={busy} className="mt-2 text-xs text-rose-500 underline">{t("remove_pin")}</button>
    </Card>
  );
}

function Dashboard({ token, studentName, onSignOut, onExpired }: { token: string; studentName: string; onSignOut: () => void; onExpired: () => void }) {
  const t = useText(T);
  const { lang } = useApp();
  const [data, setData] = useState<any>(null);
  const [askError, setAskError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<any>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/parent/summary`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : r.json().then((j: any) => Promise.reject(j)))
      .then(setData)
      .catch(() => onExpired());
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true); setAskError(""); setAnswer(null);
    try {
      const r = await fetch(`${API}/api/parent/ask`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: question.trim(), lang }),
      });
      if (!r.ok) throw new Error("parent question failed");
      setAnswer(await r.json());
    } catch { setAskError(t("ask_error")); }
    finally { setAsking(false); }
  }

  if (!data) return <div className="py-16 text-center text-sm text-[var(--muted)]">Loading…</div>;

  const name = data.student_name || studentName;
  return (
    <>
      <Card className="!bg-gradient-to-br from-[var(--brand)] to-[#0f2547] text-white">
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
          ? <p className="mt-2 text-sm text-[var(--muted)]">{t("no_apps")}</p>
          : <ul className="mt-2 space-y-2">{data.applications.map((app: any, i: number) => (
              <li key={`${app.title}-${i}`} className="rounded-xl bg-[var(--bg)] p-3 text-sm">
                <div className="flex items-start justify-between gap-2"><b>{app.title}</b><Badge tone="blue">{t(`stage_${app.stage}`)}</Badge></div>
                {app.student_approved_message && <p className="mt-2 border-t border-black/10 pt-2 text-[var(--muted)]"><b>{t("student_message")}:</b> {app.student_approved_message}</p>}
              </li>))}</ul>}
      </Card>

      <Card>
        <h3 className="font-bold">{t("ask_title")}</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">{t("ask_hint")}</p>
        <form onSubmit={ask} className="mt-3 space-y-2">
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} maxLength={500}
            placeholder={t("ask_placeholder")} aria-label={t("ask_title")} className="w-full rounded-lg bg-[var(--bg)] p-3 text-sm" />
          <button disabled={asking || !question.trim()} className="w-full rounded-xl bg-[var(--brand)] py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {asking ? t("asking") : t("ask_btn")}
          </button>
        </form>
        {answer && <div aria-live="polite" className="mt-3 rounded-xl bg-[var(--bg)] p-3 text-sm leading-relaxed">
          <p>{answer.answer}</p>
          {answer.citations?.length > 0 && <div className="mt-2 border-t border-black/10 pt-2 text-xs text-[var(--muted)]">
            {answer.citations.map((c: any) => c.source && <a key={`${c.n}-${c.source}`} className="mr-2 underline" href={c.source} target="_blank" rel="noreferrer">[{c.n}] {c.title}</a>)}
          </div>}
        </div>}
        {askError && <p role="alert" className="mt-2 text-sm text-rose-600">{askError}</p>}
      </Card>

      <Card>
        <h3 className="font-bold">{t("exams")}</h3>
        {!data.watched_exams.length
          ? <p className="mt-2 text-sm text-[var(--muted)]">{t("no_exams")}</p>
          : <ul className="mt-2 space-y-1">{data.watched_exams.map((id: string) => (
              <li key={id} className="flex items-center gap-2 rounded-xl bg-[var(--bg)] px-3 py-2 text-sm">
                <span className="text-base"></span><span className="font-medium">{id}</span>
              </li>))}</ul>}
      </Card>

      <Card>
        <h3 className="font-bold">{t("lessons")}</h3>
        {!data.lessons_done.length
          ? <p className="mt-2 text-sm text-[var(--muted)]">{t("no_lessons")}</p>
          : <ul className="mt-2 space-y-1 text-sm">{data.lessons_done.slice(0, 10).map((l: any, i: number) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--bg)] px-3 py-2">
                <span className="font-medium">{l.subject || l.id || t("subject")}</span>
                <span className="text-[11px] text-[var(--muted)]">{l.received_at ? timeAgo(l.received_at) : ""}</span>
              </li>))}</ul>}
      </Card>

      <Card>
        <h3 className="font-bold">{t("notifications")}</h3>
        {!data.notifications.length
          ? <p className="mt-2 text-sm text-[var(--muted)]">{t("no_notifs")}</p>
          : <ul className="mt-2 space-y-1 text-sm">{data.notifications.slice(0, 8).map((n: any) => (
              <li key={n.id} className="rounded-xl bg-[var(--bg)] px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{n.title || n.kind}</span>
                  <span className="shrink-0 text-[11px] text-[var(--muted)]">{timeAgo(n.created_at)}</span>
                </div>
                {n.body && <p className="mt-0.5 text-xs text-[var(--muted)]">{n.body}</p>}
              </li>))}</ul>}
      </Card>

      <button onClick={onSignOut} className="mt-2 w-full rounded-xl bg-[var(--bg)] py-3 text-sm font-semibold text-[var(--muted)]">
        {t("sign_out")}
      </button>
    </>
  );
}

export default function ParentPage() {
  const t = useText(T);
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
    <Shell title={t("title")} publicPage>
      {familyToken
        ? <Dashboard token={familyToken} studentName={studentName} onSignOut={signOut} onExpired={() => { signOut(); setExpired(true); }} />
        : <>
            {auth?.token && auth.user.role === "student" && (
              <div className="mb-2">
                <p className="mb-1 px-1 text-xs font-semibold text-[var(--muted)]">{t("for_student")}</p>
                <PinManager studentToken={auth.token} />
              </div>
            )}
            {expired && <p className="mb-2 rounded-xl bg-amber-50 p-2 text-sm text-amber-900">{t("expired")}</p>}
            <SignInForm onToken={(tok, name) => { setExpired(false); setFamilyToken(tok); setStudentName(name); }} />
          </>}
    </Shell>
  );
}
