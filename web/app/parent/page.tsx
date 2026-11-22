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
    sign_out: "Sign out",
    pin_set_title: "Set your family PIN", pin_set_sub: "Let a parent or guardian see your progress. Choose a 4–8 digit PIN they will enter on this page.",
    new_pin: "New family PIN (4–8 digits)", save_pin: "Save PIN", saving: "Saving…", pin_saved: "PIN saved!",
    remove_pin: "Remove PIN",
    for_student: "For the student — set a family PIN",
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
    sign_out: "साइन आउट",
    pin_set_title: "फैमिली PIN सेट करें", pin_set_sub: "माता-पिता को प्रगति देखने दें। 4–8 अंकों का PIN चुनें।",
    new_pin: "नया फैमिली PIN (4–8 अंक)", save_pin: "PIN सेव करें", saving: "सेव हो रहा है…", pin_saved: "PIN सेव हुआ!",
    remove_pin: "PIN हटाएँ",
    for_student: "छात्र के लिए — फैमिली PIN सेट करें",
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
    sign_out: "साइन आउट",
    pin_set_title: "कुटुंब PIN सेट करा", pin_set_sub: "पालकांना तुमची प्रगती पाहू द्या. 4–8 अंकांचा PIN निवडा.",
    new_pin: "नवीन कुटुंब PIN (4–8 अंक)", save_pin: "PIN सेव करा", saving: "सेव होत आहे…", pin_saved: "PIN सेव झाला!",
    remove_pin: "PIN काढा",
    for_student: "विद्यार्थ्यासाठी — कुटुंब PIN सेट करा",
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

function Dashboard({ token, studentName, onSignOut }: { token: string; studentName: string; onSignOut: () => void }) {
  const t = useText(T);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`${API}/api/parent/summary`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : r.json().then((j: any) => Promise.reject(j)))
      .then(setData)
      .catch(() => setErr(t("wrong")));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <Card><p className="text-sm text-rose-500">{err}</p></Card>;
  if (!data) return <div className="py-16 text-center text-sm text-[var(--muted)]">Loading…</div>;

  const name = data.student_name || studentName;
  return (
    <>
      <Card className="!bg-gradient-to-br from-[var(--brand)] to-[#0f2547] text-white">
        <div className="text-sm text-white/70">{t("welcome")}</div>
        <div className="mt-1 text-2xl font-extrabold leading-tight">{name}</div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-white/10 p-2.5">
            <div className="text-[11px] text-white/70">{t("career")}</div>
            <div className="text-sm font-semibold leading-snug">{data.roadmap_career || t("not_set")}</div>
          </div>
          <div className="rounded-xl bg-white/10 p-2.5">
            <div className="text-[11px] text-white/70">{t("stage")}</div>
            <div className="text-sm font-semibold">{data.roadmap_at || t("not_set")}</div>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="font-bold">📋 {t("exams")}</h3>
        {!data.watched_exams.length
          ? <p className="mt-2 text-sm text-[var(--muted)]">{t("no_exams")}</p>
          : <ul className="mt-2 space-y-1">{data.watched_exams.map((id: string) => (
              <li key={id} className="flex items-center gap-2 rounded-xl bg-[var(--bg)] px-3 py-2 text-sm">
                <span className="text-base">📝</span><span className="font-medium">{id}</span>
              </li>))}</ul>}
      </Card>

      <Card>
        <h3 className="font-bold">📚 {t("lessons")}</h3>
        {!data.lessons_done.length
          ? <p className="mt-2 text-sm text-[var(--muted)]">{t("no_lessons")}</p>
          : <ul className="mt-2 space-y-1 text-sm">{data.lessons_done.slice(0, 10).map((l: any, i: number) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--bg)] px-3 py-2">
                <span className="font-medium">{l.subject || l.id || t("subject")}</span>
                <span className="text-[11px] text-[var(--muted)]">{l.received_at ? timeAgo(l.received_at) : ""}</span>
              </li>))}</ul>}
      </Card>

      <Card>
        <h3 className="font-bold">🔔 {t("notifications")}</h3>
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
        ? <Dashboard token={familyToken} studentName={studentName} onSignOut={signOut} />
        : <>
            {auth?.token && auth.user.role === "student" && (
              <div className="mb-2">
                <p className="mb-1 px-1 text-xs font-semibold text-[var(--muted)]">{t("for_student")}</p>
                <PinManager studentToken={auth.token} />
              </div>
            )}
            <SignInForm onToken={(tok, name) => { setFamilyToken(tok); setStudentName(name); }} />
          </>}
    </Shell>
  );
}
