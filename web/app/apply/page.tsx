"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Shell } from "@/components/ui";
import { useApp } from "@/lib/store";
import { eligibility } from "@/lib/engine";


const FIELDS = ["name", "age", "gender", "class", "taluka", "marks_pct", "category", "family_income_annual", "school_type", "domicile", "documents", "religion", "parent_construction_worker", "parent_ex_serviceman"];
const STAGES = ["researching", "docs_submitted", "applied", "waiting", "result"];
type AppRecord = { id: number; scheme_id: string; title: string; stage: string; checklist: { doc: string; where: string; ready: boolean }[]; prefill: Record<string, any>; parent_message: string | null; parent_approved_at: number | null };

function parentDraft(lang: string, name: string, scholarship: string, amount: string) {
  if (lang === "mr") return `आई-बाबा, मी ${name || ""}. ${scholarship} साठी मी पात्र आहे असे Raah च्या तपासणीत दिसते. लाभाची माहिती: ${amount}. अर्जाची माहिती आणि कागदपत्रे तपासत आहे. मी अर्ज करू का?`;
  if (lang === "hi") return `माँ-पापा, ${scholarship} के लिए Raah की जाँच में मैं पात्र दिख रहा/रही हूँ। लाभ की जानकारी: ${amount}। मैं आवेदन और दस्तावेज़ देख रहा/रही हूँ। क्या मैं आवेदन करूँ?`;
  return `Hi, Raah's eligibility check says I may qualify for ${scholarship}. The listed benefit is ${amount}. I'm reviewing the application and documents. May I apply?`;
}

export default function ApplyPage() {
  const { data, profile, auth, authReady, authFetch, lang, t: appT } = useApp();
  const t = (key: string) => appT(`apply_${key}`);
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [selected, setSelected] = useState("");
  const [active, setActive] = useState<AppRecord | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const eligibilityRows = useMemo(() => data && profile ? eligibility(data, profile) : [], [data, profile]);

  useEffect(() => {
    const scheme = new URLSearchParams(window.location.search).get("scheme");
    if (scheme) setSelected(scheme);
  }, []);

  const load = useCallback(async () => {
    if (!auth) return;
    const r = await authFetch("/api/scholarship-applications");
    if (!r.ok) { setErr(t("load_error")); return; }
    const rows: AppRecord[] = await r.json();
    setApps(rows);
    const current = rows.find((x) => x.scheme_id === selected) ?? rows[0] ?? null;
    setActive(current);
    if (!selected && current) setSelected(current.scheme_id);
  }, [auth, authFetch, selected, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (authReady && auth) load(); }, [authReady, auth, load]);

  const scheme = data?.scholarships?.find((s: any) => s.id === selected);
  const eligibilityRow = eligibilityRows.find((e: any) => e.id === selected);
  const canStart = eligibilityRow && ["eligible", "eligible_missing_docs"].includes(eligibilityRow.status);

  useEffect(() => {
    if (!active || active.scheme_id !== selected) return;
    setMessage(active.parent_message || parentDraft(lang, profile?.name || auth?.user?.name || "", active.title, scheme?.amount_text || t("see_official")));
  }, [active, selected, lang, profile?.name, auth?.user?.name, scheme?.amount_text]);

  async function start() {
    if (!scheme || !canStart) return;
    setBusy(true); setErr("");
    const r = await authFetch("/api/scholarship-applications", { method: "POST", body: JSON.stringify({ scheme_id: selected, prefill: profile || {} }) });
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).detail || t("save_error")); setBusy(false); return; }
    const row: AppRecord = await r.json();
    setActive(row); setApps((all) => [row, ...all.filter((x) => x.id !== row.id)]); setBusy(false);
  }

  async function update(patch: Record<string, any>) {
    if (!active) return;
    setBusy(true); setErr("");
    const r = await authFetch(`/api/scholarship-applications/${active.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (!r.ok) { setErr(t("save_error")); setBusy(false); return; }
    const row: AppRecord = await r.json();
    setActive(row); setApps((all) => all.map((x) => x.id === row.id ? row : x)); setBusy(false);
  }

  async function share() {
    if (!active) return;
    setBusy(true); setErr(""); setNotice("");
    const r = await authFetch(`/api/scholarship-applications/${active.id}/share-with-parent`, {
      method: "POST", body: JSON.stringify({ message }),
    });
    const result = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(result.detail === "Set a family PIN in Parent mode before sharing a message" ? t("set_pin") : (result.detail || t("save_error"))); setBusy(false); return; }
    setActive(result); setApps((all) => all.map((x) => x.id === result.id ? result : x)); setNotice(t("shared")); setBusy(false);
  }

  async function copyPrefill() {
    if (!active) return;
    const serialized = FIELDS.filter((key) => active.prefill[key] !== undefined)
      .map((key) => `${t(key === "documents" ? "documents_list" : key)}: ${Array.isArray(active.prefill[key]) ? active.prefill[key].join(", ") : String(active.prefill[key])}`).join("\n");
    try { await navigator.clipboard.writeText(serialized); setNotice(t("copied")); }
    catch { setErr(t("save_error")); }
  }

  return (
    <Shell title={t("title")}>
      <Card>
        <p className="text-sm text-[var(--muted)]">{t("intro")}</p>
        <label className="mt-3 block text-sm font-semibold">{t("choose")}
          <select value={selected} onChange={(e) => { setSelected(e.target.value); setActive(apps.find((x) => x.scheme_id === e.target.value) ?? null); setErr(""); setNotice(""); }}
            className="mt-1 w-full rounded-lg bg-[var(--bg)] p-2 text-sm">
            <option value="" />{(data?.scholarships || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </Card>

      {!authReady && <Card><p className="text-sm text-[var(--muted)]">…</p></Card>}
      {authReady && !auth && <Card><a className="font-semibold text-[var(--brand-ink)] underline" href="/login/">{t("sign_in")}</a></Card>}
      {auth && selected && !active && (
        <Card className="space-y-3">
          {eligibilityRow && <p className="text-sm font-semibold">{eligibilityRow.status === "eligible" ? t("eligible") : eligibilityRow.status === "eligible_missing_docs" ? t("missing") : t("not_eligible")}</p>}
          {scheme?.source && <a className="text-sm text-[var(--brand-ink)] underline" href={scheme.source} target="_blank" rel="noreferrer">{t("source")}</a>}
          <button onClick={start} disabled={busy || !canStart} className="w-full rounded-xl bg-[var(--brand)] py-3 font-semibold text-white disabled:opacity-50">{busy ? "…" : t("start")}</button>
          {!canStart && <a href="/profile/" className="block text-sm text-[var(--brand-ink)] underline">{t("profile")}</a>}
        </Card>
      )}

      {active && active.scheme_id === selected && (
        <>
          <Card>
            <h2 className="font-bold">{t("steps")}</h2>
            <p className="mt-1 text-sm text-[var(--good)]">✓ {t("eligibility")}{eligibilityRow ? ` · ${eligibilityRow.passed}/${eligibilityRow.total}` : ""}</p>
          <div className="mt-2 flex flex-wrap gap-1">{STAGES.map((stage) => <button key={stage} onClick={() => update({ stage })}
              aria-pressed={active.stage === stage} className={`rounded-full px-2.5 py-1 text-xs ${active.stage === stage ? "bg-[var(--brand)] text-white" : "bg-[var(--bg)] text-[var(--muted)]"}`}>{t(stage === "researching" ? "preparing" : stage)}</button>)}</div>
            {scheme?.apply_via && <a className="mt-3 inline-block text-sm font-semibold text-[var(--brand-ink)] underline" href={scheme.apply_via.match(/^https?:\/\//i) ? scheme.apply_via : scheme.source} target="_blank" rel="noreferrer">{t("official")}: {scheme.apply_via}</a>}
          </Card>

          <Card className="space-y-2">
            <h2 className="font-bold">{t("documents")}</h2>
            {!active.checklist.length && <p className="text-sm text-[var(--muted)]">{t("none_docs")}</p>}
            {active.checklist.map((doc, i) => <label key={doc.doc} className="flex items-start gap-2 rounded-lg bg-[var(--bg)] p-2 text-sm">
              <input type="checkbox" checked={doc.ready} onChange={(e) => update({ checklist: active.checklist.map((d, n) => n === i ? { ...d, ready: e.target.checked } : d) })} className="mt-0.5 h-5 w-5" />
              <span className="min-w-0"><b>{doc.doc}</b><span className="block text-xs text-[var(--muted)]">{doc.ready ? t("ready") : t("missing_doc")} · {t("get")}: {doc.where}</span></span>
            </label>)}
            <button onClick={() => update({ stage: "applied" })} disabled={busy || active.stage === "applied"}
              className="w-full rounded-xl bg-[var(--bg)] py-2 text-sm font-semibold disabled:opacity-50">{t("submitted")}</button>
          </Card>

          <Card className="space-y-2">
            <h2 className="font-bold">{t("prefill")}</h2><p className="text-xs text-[var(--muted)]">{t("prefill_note")}</p>
            {FIELDS.filter((key) => active.prefill[key] !== undefined).map((key) => <label key={key} className="block text-xs text-[var(--muted)]">{t(key === "documents" ? "documents_list" : key)}
              <input value={Array.isArray(active.prefill[key]) ? active.prefill[key].join(", ") : String(active.prefill[key] ?? "")}
                onChange={(e) => setActive({ ...active, prefill: { ...active.prefill, [key]: key === "documents" ? e.target.value.split(",").map((x: string) => x.trim()).filter(Boolean) : e.target.value } })}
                className="mt-1 w-full rounded-lg bg-[var(--bg)] p-2 text-sm text-[var(--ink)]" />
            </label>)}
            <div className="flex gap-2"><button onClick={() => update({ prefill: active.prefill })} disabled={busy} className="flex-1 rounded-xl bg-[var(--bg)] py-2 text-sm font-semibold">{t("save")}</button>
              <button onClick={copyPrefill} className="flex-1 rounded-xl bg-[var(--brand)] py-2 text-sm font-semibold text-white">{t("copy")}</button></div>
          </Card>

          <Card className="space-y-2">
            <h2 className="font-bold">{t("parent_title")}</h2><p className="text-xs text-[var(--muted)]">{t("parent_note")}</p>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={1000} aria-label={t("message")}
              className="w-full rounded-lg bg-[var(--bg)] p-3 text-sm" />
            {active.parent_approved_at && <p className="text-xs text-[var(--good)]">{t("shared")}</p>}
            <button onClick={share} disabled={busy || message.trim().length < 5} className="w-full rounded-xl bg-[var(--brand)] py-2.5 text-sm font-semibold text-white disabled:opacity-50">{t("share")}</button>
          </Card>
          <a href="/compare/" className="block rounded-xl bg-[var(--card)] p-4 text-center text-sm font-semibold text-[var(--brand-ink)] underline">{t("compare")}</a>
          <p className="px-1 text-xs text-[var(--muted)]">{t("source_note")}</p>
        </>
      )}
      {err && <p role="alert" className="rounded-xl bg-rose-100 p-3 text-sm text-rose-800">{err}{err === t("set_pin") && <a href="/parent/" className="ml-2 underline">{t("parent_link")}</a>}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-100 p-3 text-sm text-emerald-800">{notice}</p>}
    </Shell>
  );
}
