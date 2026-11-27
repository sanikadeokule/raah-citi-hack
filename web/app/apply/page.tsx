"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Card, Shell } from "@/components/ui";
import { LANGS, translateForLanguage, useApp } from "@/lib/store";
import { languageLocale } from "@/lib/languages";
import { eligibility } from "@/lib/engine";

const FIELDS = ["name", "age", "gender", "class", "taluka", "marks_pct", "category", "family_income_annual", "school_type", "domicile", "documents", "religion", "parent_construction_worker", "parent_ex_serviceman"];
const REQUIRED = ["name", "age", "class", "taluka", "marks_pct", "family_income_annual"];
type Doc = { doc: string; where: string; ready: boolean };
type AppRecord = {
  id: number; scheme_id: string; title: string; stage: string; checklist: Doc[]; prefill: Record<string, any>;
  parent_message: string | null; parent_approved_at: number | null; student_approved_at: number | null; parent_sent_at: number | null;
  parent_agreed_at: number | null; submitted_at: number | null; remind_at: number | null;
};
type View = "list" | "docs" | "review" | "parent";

const empty = (v: any) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
const nice = (d: string) => { const x = d.replace(/_/g, " "); return x.charAt(0).toUpperCase() + x.slice(1); };
const minor = (a: AppRecord) => Number(a.prefill.age) < 18;

export default function ApplyPage() {
  const { data, profile, auth, authReady, authFetch, lang, t: tt } = useApp();
  const t = (k: string, v?: Record<string, string | number>) => tt(`ap_${k}`, v);
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [view, setView] = useState<View>("list");
  const [active, setActive] = useState<AppRecord | null>(null);
  const [msgLang, setMsgLang] = useState(lang);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [deepLinked, setDeepLinked] = useState(false);
  const eligibilityRows = useMemo(() => data && profile ? eligibility(data, profile) : [], [data, profile]);
  const date = (ts: number) => new Date(ts * 1000).toLocaleDateString(languageLocale(lang), { day: "numeric", month: "short" });
  const scheme = (id: string) => data?.scholarships?.find((s: any) => s.id === id);

  const load = useCallback(async () => {
    if (!auth) return;
    const r = await authFetch("/api/scholarship-applications");
    if (!r.ok) { setErr(t("load_error")); return; }
    setApps(await r.json());
  }, [auth, authFetch, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (authReady && auth) load(); }, [authReady, auth, load]);

  const save = (row: AppRecord) => { setActive(row); setApps((all) => all.some((x) => x.id === row.id) ? all.map((x) => x.id === row.id ? row : x) : [row, ...all]); };
  const fail = async (r: Response) => {
    const j = await r.json().catch(() => ({}));
    const d = j.detail;
    const key = d === "Set a family PIN in Parent mode before sharing a message" ? "set_pin"
      : d === "A parent must agree before this is submitted" ? "need_parent"
      : d === "Review and approve the application first" || d === "Approve the application before asking a parent" ? "need_approve"
      : d && typeof d === "object" && "missing" in d ? "fill_in" : "save_error";
    setErr(t(key));
  };

  async function start(id: string) {
    setBusy(true); setErr("");
    const r = await authFetch("/api/scholarship-applications", { method: "POST", body: JSON.stringify({ scheme_id: id }) });
    setBusy(false);
    if (!r.ok) { await fail(r); return; }
    const row: AppRecord = await r.json();
    save(row); setView("docs");
  }

  useEffect(() => {
    if (deepLinked || !authReady || !auth || !data) return;
    const id = new URLSearchParams(window.location.search).get("scheme");
    setDeepLinked(true);
    if (!id) return;
    const have = apps.find((a) => a.scheme_id === id);
    if (have) { setActive(have); setView("docs"); } else if (eligibilityRows.some((e: any) => e.id === id && ["eligible", "eligible_missing_docs"].includes(e.status))) start(id);
  }, [authReady, auth, data, apps, eligibilityRows]); // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(body: Record<string, any>) {
    if (!active) return null;
    setBusy(true); setErr("");
    const r = await authFetch(`/api/scholarship-applications/${active.id}`, { method: "PATCH", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { await fail(r); return null; }
    const row: AppRecord = await r.json(); save(row); return row;
  }
  async function post(path: string, body?: any) {
    if (!active) return null;
    setBusy(true); setErr("");
    const r = await authFetch(`/api/scholarship-applications/${active.id}/${path}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });
    setBusy(false);
    if (!r.ok) { await fail(r); return null; }
    const row: AppRecord = await r.json(); save(row); return row;
  }

  function open(a: AppRecord, v: View) { setActive(a); setView(v); setErr(""); setNotice(""); setEditing(false); }
  function statusOf(a: AppRecord): { tone: "green" | "amber" | "blue" | "gray"; label: string; line: string } {
    const total = a.checklist.length, ready = a.checklist.filter((d) => d.ready).length;
    if (a.submitted_at) return { tone: "green", label: t("submitted_on", { date: date(a.submitted_at) }), line: t("waiting_office") };
    if (a.parent_agreed_at) return { tone: "green", label: t("parent_agreed"), line: t("n_of_m", { n: ready, m: total }) };
    if (a.parent_sent_at) return { tone: "amber", label: t("waiting_parent"), line: t("n_of_m", { n: ready, m: total }) };
    if (ready < total) return { tone: "amber", label: t("needs_doc"), line: a.remind_at ? t("check_again", { date: date(a.remind_at) }) : t("n_of_m", { n: ready, m: total }) };
    return { tone: "blue", label: t("docs_ready"), line: t("in_progress") };
  }

  function openParent(a: AppRecord, l = lang) {
    setMsgLang(l);
    setMessage(a.parent_message && l === lang ? a.parent_message : translateForLanguage(l, "ap_parent_draft", {
      name: a.prefill.name || auth?.user?.name || "", scholarship: a.title, amount: scheme(a.scheme_id)?.amount_text || "",
    }));
  }

  async function approve() {
    if (!active) return;
    const saved = await patch({ prefill: active.prefill });
    if (!saved) return;
    const row = await post("approve");
    if (!row) return;
    if (minor(row)) { openParent(row); setView("parent"); } else { setNotice(t("approved")); setView("docs"); }
  }
  async function sendToParent() {
    const row = await post("ask-parent", { message, lang: msgLang });
    if (row) { setNotice(t("sent_ok")); setView("docs"); }
  }
  async function remind() {
    const row = await post("remind");
    if (row?.remind_at) setNotice(`${t("remind_set")} ${t("check_again", { date: date(row.remind_at) })}`);
  }

  const btn = "w-full rounded-xl py-3 text-sm font-semibold disabled:opacity-50";
  const primary = `${btn} bg-[var(--brand)] text-white`, quiet = `${btn} bg-[var(--card)] text-[var(--ink)] ring-1 ring-black/10`;
  const eligibleRows = eligibilityRows.filter((e: any) => !apps.some((a) => a.scheme_id === e.id) && ["eligible", "eligible_missing_docs"].includes(e.status));
  const title = view === "list" || !active ? t("my_apps") : active.title;

  return (
    <Shell title={t("title")} back={view === "list" ? "/" : null}>
      {!authReady && <Card><p className="text-sm text-[var(--muted)]">…</p></Card>}
      {authReady && !auth && <Card><a className="font-semibold text-[var(--brand-ink)] underline" href="/login/">{t("sign_in")}</a></Card>}

      {auth && view === "list" && (
        <>
          <h2 className="px-1 text-lg font-bold">{title}</h2>
          {!apps.length && <p className="px-1 text-sm text-[var(--muted)]">{t("no_apps")}</p>}
          {apps.map((a) => { const s = statusOf(a); return (
            <Card key={a.id} className="space-y-2">
              <div className="flex items-start justify-between gap-2"><b className="text-sm leading-snug">{a.title}</b><Badge tone={s.tone}>{s.label}</Badge></div>
              <p className="text-xs text-[var(--muted)]">{s.line}</p>
              <button onClick={() => open(a, "docs")} className={quiet}>{a.submitted_at ? t("tracking") : t("continue")}</button>
            </Card>); })}
          {eligibleRows.slice(0, 4).map((e: any) => (
            <Card key={e.id} className="space-y-2">
              <div className="flex items-start justify-between gap-2"><b className="text-sm leading-snug">{scheme(e.id)?.name || e.id}</b>
                <Badge tone={e.status === "eligible" ? "gray" : "amber"}>{e.status === "eligible" ? t("not_started") : t("needs_doc")}</Badge></div>
              <button onClick={() => start(e.id)} disabled={busy} className={primary}>{t("start_btn")}</button>
            </Card>))}
          <a href="/eligibility/" className="block rounded-xl bg-[var(--card)] p-4 text-center text-sm font-semibold text-[var(--brand-ink)] underline">{t("find_more")}</a>
        </>
      )}

      {auth && active && view === "docs" && (() => {
        const ready = active.checklist.filter((d) => d.ready).length, total = active.checklist.length;
        const canSubmit = active.student_approved_at && (!minor(active) || active.parent_agreed_at);
        const sch = scheme(active.scheme_id);
        return (
          <>
            <h2 className="px-1 text-lg font-bold">{active.title}</h2>
            <Card className="space-y-2">
              <div className="flex items-center justify-between"><h3 className="font-bold">{t("documents")}</h3><Badge tone={ready === total ? "green" : "amber"}>{t("n_of_m", { n: ready, m: total })}</Badge></div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--bg)]"><div className="h-full bg-[var(--brand)]" style={{ width: `${total ? (ready / total) * 100 : 0}%` }} /></div>
              {!total && <p className="text-sm text-[var(--muted)]">{t("none_docs")}</p>}
              {active.checklist.map((d, i) => (
                <label key={d.doc} className="flex items-start gap-3 rounded-lg bg-[var(--bg)] p-3 text-sm">
                  <input type="checkbox" checked={d.ready} className="mt-0.5 h-5 w-5"
                    onChange={(e) => patch({ checklist: active.checklist.map((x, n) => n === i ? { ...x, ready: e.target.checked } : x) })} />
                  <span className="min-w-0"><b>{nice(d.doc)}</b>
                    <span className={`block text-xs ${d.ready ? "text-[var(--good)]" : "text-[var(--muted)]"}`}>{d.ready ? t("have") : t("missing_get", { where: d.where })}</span></span>
                </label>))}
              {ready < total && <button onClick={remind} disabled={busy} className={quiet}>{t("remind_me")}</button>}
              {active.remind_at && ready < total && <p className="text-xs text-[var(--muted)]">{t("check_again", { date: date(active.remind_at) })}</p>}
            </Card>
            {!active.student_approved_at && <button onClick={() => { setNotice(""); setView("review"); }} className={primary}>{t("next_form")}</button>}
            {active.student_approved_at && minor(active) && !active.parent_agreed_at && (
              <Card className="space-y-2"><p className="text-sm">{active.parent_sent_at ? t("awaiting") : t("minor_gate")}</p>
                <button onClick={() => { setNotice(""); openParent(active); setView("parent"); }} className={quiet}>{t("parent_title")}</button></Card>)}
            {active.parent_agreed_at && <p className="px-1 text-sm text-[var(--good)]">{t("parent_agreed")}</p>}
            {canSubmit && !active.submitted_at && (
              <Card className="space-y-2">
                {sch?.apply_via && <a className="block text-sm font-semibold text-[var(--brand-ink)] underline" href={String(sch.apply_via).match(/^https?:\/\//i) ? sch.apply_via : sch.source} target="_blank" rel="noreferrer">{t("official")}: {sch.apply_via}</a>}
                <button onClick={() => patch({ stage: "applied" })} disabled={busy} className={primary}>{t("submitted")}</button>
              </Card>)}
            {active.submitted_at && <p className="px-1 text-sm font-semibold text-[var(--good)]">{t("submitted_on", { date: date(active.submitted_at) })}</p>}
            <button onClick={() => setView("list")} className={quiet}>{t("back_list")}</button>
            <p className="px-1 text-xs text-[var(--muted)]">{t("source_note")}</p>
          </>);
      })()}

      {auth && active && view === "review" && (() => {
        const gaps = REQUIRED.filter((k) => empty(active.prefill[k]));
        const shown = FIELDS.filter((k) => REQUIRED.includes(k) || active.prefill[k] !== undefined);
        return (
          <>
            <h2 className="px-1 text-lg font-bold">{t("review_title")}</h2>
            <Card className="space-y-2">
              <p className="text-xs text-[var(--muted)]">{t("prefill_note")}</p>
              {shown.map((k) => { const missing = REQUIRED.includes(k) && empty(active.prefill[k]); return (
                <label key={k} className="block text-xs text-[var(--muted)]">
                  <span className="flex items-center justify-between">{t(k === "documents" ? "documents_list" : k)}{missing && <Badge tone="red">{t("missing_field")}</Badge>}</span>
                  <input value={Array.isArray(active.prefill[k]) ? active.prefill[k].join(", ") : String(active.prefill[k] ?? "")}
                    onChange={(e) => setActive({ ...active, prefill: { ...active.prefill, [k]: k === "documents" ? e.target.value.split(",").map((x) => x.trim()).filter(Boolean) : e.target.value } })}
                    className={`mt-1 w-full rounded-lg bg-[var(--bg)] p-2 text-sm text-[var(--ink)] ${missing ? "ring-2 ring-rose-300" : ""}`} />
                </label>); })}
              {gaps.length > 0 && <p role="alert" className="text-sm text-rose-700">{t("fill_in")}</p>}
              {minor(active) && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t("minor_gate")}</p>}
              <p className="text-sm font-semibold">{t("never_sends")}</p>
            </Card>
            <button onClick={approve} disabled={busy || gaps.length > 0} className={primary}>{minor(active) ? t("approve_ask") : t("approve")}</button>
            <button onClick={async () => { if (await patch({ prefill: active.prefill })) setView("list"); }} disabled={busy} className={quiet}>{t("save_later")}</button>
          </>);
      })()}

      {auth && active && view === "parent" && (
        <>
          <h2 className="px-1 text-lg font-bold">{t("parent_title")}</h2>
          <Card className="space-y-3">
            <div><p className="mb-1 text-xs text-[var(--muted)]">{t("msg_lang")}</p>
              <div className="flex flex-wrap gap-2">{LANGS.map((language) => (
                <button key={language.code} aria-pressed={msgLang === language.code} onClick={() => openParent(active, language.code)}
                  className={`rounded-full px-3 py-1 text-sm ${msgLang === language.code ? "bg-[var(--brand)] text-white" : "bg-[var(--bg)]"}`}>{language.label}</button>))}</div></div>
            <p className="text-xs text-[var(--muted)]">{t("preview")}</p>
            {editing ? <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={1000} aria-label={t("message")} className="w-full rounded-lg bg-[var(--bg)] p-3 text-sm" />
              : <p className="whitespace-pre-wrap rounded-lg bg-[var(--bg)] p-3 text-sm leading-relaxed">{message}</p>}
            <p className="text-xs text-[var(--muted)]">{t("mock_note")}</p>
          </Card>
          <button onClick={sendToParent} disabled={busy || message.trim().length < 5} className={primary}>{t("yes_send")}</button>
          <button onClick={() => setEditing((e) => !e)} className={quiet}>{editing ? t("done_edit") : t("edit_msg")}</button>
          <button onClick={() => setView("docs")} className={quiet}>{t("dont_send")}</button>
        </>
      )}

      {err && <p role="alert" className="rounded-xl bg-rose-100 p-3 text-sm text-rose-800">{err}{err === t("set_pin") && <a href="/parent/" className="ml-2 underline">{t("parent_link")}</a>}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-100 p-3 text-sm text-emerald-800">{notice}</p>}
    </Shell>
  );
}
