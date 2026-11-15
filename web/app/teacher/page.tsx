"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { Badge, Card, Shell, Stat } from "@/components/ui";
import { useApp } from "@/lib/store";
import { getKV, setKV } from "@/lib/db";

export default function Teacher() {
  const { data, t, showToast, authFetch, auth } = useApp();
  const [cls, setCls] = useState<any>(null);
  const [scheme, setScheme] = useState("SCH16");
  const [planId, setPlanId] = useState("PLN01");
  const [eligible, setEligible] = useState<any>(null);
  const [filter, setFilter] = useState<"all" | "risk" | "talent">("all");

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
  if (!cls) return <Shell title={t("teacher_dashboard")} role="teacher"><Card>Connect to the Raah server to load the class.</Card></Shell>;
  const st = cls.students;
  const shown = st.filter((s: any) => filter === "all" || (filter === "risk" ? s.risk_level === "high" : s.talent));
  return (
    <Shell title={t("teacher_dashboard")} role="teacher">
      <div className="grid grid-cols-3 gap-2">
        <Stat label={t("students")} value={String(st.length)} />
        <Stat label={t("risk")} value={String(st.filter((s: any) => s.risk_level === "high").length)} tone="text-[var(--bad)]" />
        <Stat label={t("talent")} value={String(st.filter((s: any) => s.talent).length)} tone="text-[var(--good)]" />
      </div>
      <Card>
        <h2 className="font-bold">📣 {t("recommend_all")}</h2>
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
            {" "}📱 {t("sent_to_app", { n: eligible.students.filter((s: any) => s.real).length })}</p>
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
        <ul className="divide-y divide-black/5">
          {shown.map((s: any) => (
            <li key={s.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <b>{s.name}</b>
                <span className="flex gap-1">
                  {s.talent && <Badge tone="green">⭐ {t("talent")}</Badge>}
                  <Badge tone={s.risk_level === "high" ? "red" : s.risk_level === "medium" ? "amber" : "gray"}>{Math.round(s.dropout_risk * 100)}%</Badge>
                </span>
              </div>
              <div className="text-xs text-[var(--muted)]">{s.taluka} · {s.marks_pct}% · profile {s.profile_completion}% · {s.top_career}</div>
              {s.risk_level !== "low" && s.reasons.length > 0 && <div className="text-xs text-[var(--bad)]">⚠ {s.reasons.join("; ")}</div>}
              {s.talent && <div className="text-xs text-[var(--good)]">⭐ {s.talent_reason}</div>}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-[var(--muted)]">{cls.model_note} Class roster is synthetic.</p>
      </Card>
    </Shell>
  );
}
