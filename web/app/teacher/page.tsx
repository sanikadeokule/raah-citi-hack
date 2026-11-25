"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { Badge, Card, Shell, Stat } from "@/components/ui";
import { useApp } from "@/lib/store";
import { getKV, setKV } from "@/lib/db";
import { MentorRequests, TeacherModules } from "@/components/modules";
import { TeacherNotices } from "@/components/notices";
import { Pager, usePaged } from "@/components/pager";
import { inr } from "@/lib/engine";
import { categoryLabel, talukaLabel } from "@/lib/labels";

/** A student forgot their PIN: clear it so they can register again with the same number. */
function ResetStudentPin() {
  const { t, authFetch, showToast } = useApp();
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const reset = async () => {
    const r = await authFetch("/api/auth/reset-pin", { method: "POST", body: JSON.stringify({ phone }) });
    const j = await r.json();
    if (r.ok) { showToast(t("pin_reset_done")); setPhone(""); setMsg(null); }
    else setMsg(typeof j.detail === "string" ? j.detail : "Error");
  };
  return (
    <Card className="space-y-2">
      <h2 className="font-bold">{t("reset_pin_title")}</h2>
      <p className="text-xs text-[var(--muted)]">{t("reset_pin_help")}</p>
      <div className="flex gap-2">
        <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric"
          placeholder="98XXXXXXXX" className="flex-1 rounded-lg bg-[var(--bg)] p-2" />
        <button onClick={reset} disabled={phone.length !== 10} className="rounded-lg bg-[var(--brand)] px-4 font-semibold text-white disabled:opacity-40">{t("reset_pin")}</button>
      </div>
      {msg && <p className="text-sm text-rose-800">{msg}</p>}
    </Card>
  );
}

const SCHOOL: Record<string, string> = { government: "Government", aided: "Aided", local_body: "Local body", private: "Private", top_class: "Top-class" };

/** One student as a card. Closed it shows who and how worried to be; open it lists the details as bullets. */
function StudentCard({ s }: { s: any }) {
  const { t, lang } = useApp();
  const riskTone = s.risk_level === "high" ? "red" : s.risk_level === "medium" ? "amber" : "gray";
  const yes = (v: boolean | undefined) => (v ? "Yes" : "No");
  const rows: [string, React.ReactNode][] = [
    ["Class", s.class ? `${s.class}${s.age ? ` · age ${s.age}` : ""}` : "—"],
    ["Taluka", talukaLabel(s.taluka, lang) || "—"],
    ["Marks", s.marks_pct != null ? `${s.marks_pct}%` : "—"],
    ["Best career match", s.top_career || "—"],
    ["Interests", s.interests?.length ? s.interests.join(", ") : "—"],
    ["Category", categoryLabel(s.category, lang) || "—"],
    ["Family income", s.family_income_annual != null ? `${inr(s.family_income_annual)} / year` : "—"],
    ["Can travel", s.max_commute_km != null ? `${s.max_commute_km} km` : "—"],
    ["Can stay in hostel", yes(s.can_stay_hostel)],
    ["School", SCHOOL[s.school_type] ?? s.school_type ?? "—"],
    ["Documents", s.documents?.length ? s.documents.map((d: string) => d.replace(/_/g, " ")).join(", ") : "none yet"],
    ["Profile completed", s.profile_completion != null ? `${s.profile_completion}%` : "—"],
  ];
  return (
    <details className="group rounded-2xl bg-[var(--card)] shadow-sm ring-1 ring-black/5">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-sm font-bold text-[var(--brand-ink)]">{String(s.name || "?").slice(0, 1)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold leading-snug">{s.name}</span>
          <span className="block truncate text-xs text-[var(--muted)]">{talukaLabel(s.taluka, lang)} · {s.marks_pct}%</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={riskTone}>{Math.round(s.dropout_risk * 100)}% {t("risk")}</Badge>
          {s.talent && <Badge tone="green"> {t("talent")}</Badge>}
        </span>
        <span aria-hidden className="text-lg text-[var(--muted)] transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="space-y-2.5 border-t border-black/5 p-3.5 pt-3">
        {s.risk_level !== "low" && s.reasons?.length > 0 && (
          <div className="rounded-xl bg-rose-50 p-2.5 text-xs leading-snug text-rose-900 dark:bg-rose-900/20 dark:text-rose-200">⚠ {s.reasons.join("; ")}</div>
        )}
        {s.talent && <div className="rounded-xl bg-emerald-50 p-2.5 text-xs leading-snug text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200">{s.talent_reason}</div>}
        <ul className="space-y-1 text-sm">
          {rows.map(([k, v]) => (
            <li key={k} className="flex gap-2"><span className="text-[var(--muted)]">•</span>
              <span><span className="text-[var(--muted)]">{k}:</span> <span className="font-medium">{v}</span></span></li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export default function Teacher() {
  const { data, t, showToast, authFetch, auth } = useApp();
  const [cls, setCls] = useState<any>(null);
  const [scheme, setScheme] = useState("SCH16");
  const [planId, setPlanId] = useState("PLN01");
  const [eligible, setEligible] = useState<any>(null);
  const [filter, setFilter] = useState<"all" | "risk" | "talent">("all");
  const [tab, setTabState] = useState<"students" | "modules" | "notices">("students");
  // remember the open tab when the teacher goes to another screen and comes back
  useEffect(() => {
    try {
      const v = sessionStorage.getItem("teacher_tab");
      if (v === "modules" || v === "notices") setTabState(v);
    } catch {}
  }, []);
  const setTab = (v: "students" | "modules" | "notices") => {
    setTabState(v);
    try { sessionStorage.setItem("teacher_tab", v); } catch {}
  };

  useEffect(() => {
    if (auth?.user.role !== "teacher") return;
    getKV("teacher_class").then((c) => c && setCls(c));
    authFetch("/api/teacher/class").then((r) => r.json()).then((c) => { setCls(c); setKV("teacher_class", c); }).catch(() => {});
  }, [data?.version?.modified, authFetch, auth]);
  useEffect(() => {
    if (auth?.user.role !== "teacher") return;
    authFetch(`/api/teacher/eligible/${scheme}?plan_id=${planId}`).then((r) => r.json()).then(setEligible).catch(() => setEligible(null));
  }, [scheme, planId, data?.version?.modified, authFetch, auth]);

  const recommend = async () => {
    const r = await authFetch("/api/teacher/recommend", { method: "POST", body: JSON.stringify({ scheme_id: scheme, plan_id: planId }) });
    const j = await r.json();
    showToast(`${t("sent_to", { n: j.sent })} · ${t("sent_to_app", { n: j.sent_to_app ?? 0 })}`);
  };
  const pg = usePaged((cls?.students ?? []).filter((s: any) => filter === "all" || (filter === "risk" ? s.risk_level === "high" : s.talent)), 5, filter);
  if (!cls) return <Shell title={t("teacher_dashboard")} role="teacher"><Card>Connect to the Raah server to load the class.</Card></Shell>;
  const st = cls.students;
  return (
    <Shell title={t("teacher_dashboard")} role="teacher">
      <div className="grid grid-cols-3 gap-2">
        <Stat label={t("students")} value={String(st.length)} />
        <Stat label={t("risk")} value={String(st.filter((s: any) => s.risk_level === "high").length)} tone="text-[var(--bad)]" />
        <Stat label={t("talent")} value={String(st.filter((s: any) => s.talent).length)} tone="text-[var(--good)]" />
      </div>
      <div role="tablist" className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--card)] p-1 ring-1 ring-black/5">
        {([["students", `${t("students")}`], ["modules", `${t("my_modules")}`], ["notices", `${t("teacher_tab_notices")}`]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-lg py-2 text-sm font-semibold ${tab === k ? "bg-[var(--brand)] text-white" : "text-[var(--muted)]"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "modules" ? <TeacherModules /> : tab === "notices" ? <TeacherNotices /> : (<>
      <Card>
        <h2 className="font-bold">{t("recommend_all")}</h2>
        <div className="mt-2 grid gap-2">
          <select value={scheme} onChange={(e) => setScheme(e.target.value)} className="w-full min-w-0 rounded-lg bg-[var(--bg)] p-2 text-sm">
            {data.scholarships.filter((s: any) => s.rules.length).map((s: any) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}
          </select>
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="w-full min-w-0 rounded-lg bg-[var(--bg)] p-2 text-sm">
            <option value="">Students now (Class 10)</option>
            {data.plans.map((p: any) => <option key={p.id} value={p.id}>If they choose: {p.label}</option>)}
          </select>
        </div>
        <button onClick={recommend} disabled={!eligible?.students?.length} className="mt-3 w-full rounded-xl bg-[var(--accent)] py-3 font-semibold text-white disabled:opacity-40">
          {t("recommend_all")} ({eligible?.students?.length ?? 0})
        </button>
        {eligible?.students?.length > 0 && (
          <p className="mt-2 text-xs text-[var(--muted)]">{eligible.students.filter((s: any) => s.status === "eligible_missing_docs").length} of them still need a document (mostly income certificate).
            {" "} {t("sent_to_app", { n: eligible.students.filter((s: any) => s.real).length })}</p>
        )}
      </Card>
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold">{t("students")}</h2>
          <div className="flex gap-1 text-xs">
            {(["all", "risk", "talent"] as const).map((f) => <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-2 py-1 ${filter === f ? "bg-[var(--brand)] text-white" : "bg-[var(--bg)]"}`}>{f}</button>)}
          </div>
        </div>
        <p className="mb-2 text-xs text-[var(--muted)]">Top interests: {cls.top_interests.map((x: any) => `${x[0]} (${x[1]})`).join(", ")}</p>
        <div ref={pg.top} />
        <div className="space-y-2">
          {pg.pageItems.map((s: any) => <StudentCard key={s.id} s={s} />)}
        </div>
        <Pager {...pg} shown={pg.pageItems.length} />
        <p className="mt-2 text-xs text-[var(--muted)]">{cls.model_note} Class roster is synthetic.</p>
      </Card>
      <MentorRequests />
      <ResetStudentPin />
      </>)}
    </Shell>
  );
}
