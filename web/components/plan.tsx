"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card, Source, SpeakButton, Stat, STATUS_TONE, docLabel } from "./ui";
import { A, inr, type PlanOptions } from "@/lib/engine";
import { useApp } from "@/lib/store";
import { SERIES } from "@/lib/theme";
import { VoiceNote } from "./voicenote";

export function paybackText(t: any, p: any, data: any) {
  if (!p) return "—";
  if (p.months_after_training === null) return t("not_in_horizon", { h: A(data, "payback_horizon_months", 120) });
  if (p.months_after_training === 0) return t("paid_back_during");
  if (p.months_after_training === 1) return t("payback_after_1");
  return t("payback_after", { m: p.months_after_training });
}

export function PaybackCard({ r }: { r: any }) {
  const { t, data } = useApp();
  const est = String(r.plan.status || "").toLowerCase().includes("estimate");
  const row = (label: string, v: number, extra?: React.ReactNode, sign = "") => (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="text-sm">{label}{extra}</span>
      <span className="whitespace-nowrap font-semibold tabular-nums">{sign}{inr(v)}</span>
    </div>
  );
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-bold">💰 {t("total_cost")} → {t("payback")}</h2>
        {est && <Badge tone="amber">{t("estimate")}</Badge>}
      </div>
      <div className="divide-y divide-black/5">
        {row(t("course_fees"), r.costs.course_fees, r.plan.fees_from !== "Plan_Inputs" ? <span className="ml-1 text-xs text-[var(--muted)]">({r.plan.fees_from})</span> : null)}
        {row(t("exam_fees"), r.costs.exam_fees)}
        {row(t("materials"), r.costs.materials)}
        {row(t(r.costs.living_label), r.costs.living, <span className="ml-1 text-xs text-[var(--muted)]">{r.inputs.hostel ? "" : `${r.inputs.commute_km} km`}</span>)}
        <div className="flex justify-between py-2 font-bold"><span>{t("total_cost")}</span><span>{inr(r.costs.total)}</span></div>
        {r.scholarship.low > 0 && row(t("scholarship_cover"), r.scholarship.low,
          <span className="ml-1 text-xs text-[var(--muted)]">{r.scholarship.chosen.join(", ")}{r.scholarship.high > r.scholarship.low ? ` (up to ${inr(r.scholarship.high)})` : ""}</span>, "− ")}
        {r.stipend.total > 0 && row(t("stipend_during_training"), r.stipend.total,
          <span className="ml-1 text-xs text-[var(--muted)]">{inr(r.stipend.per_month)} × {r.stipend.months}</span>, "− ")}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat label={t("net_cost")} value={inr(Math.max(0, r.net_cost))} tone={r.net_cost <= 0 ? "text-[var(--good)]" : ""} />
        <Stat label={t("monthly_income")} value={r.income ? inr(r.income.median) : "—"}
          sub={r.income ? `${t("low")} ${inr(r.income.low)} · ${t("high")} ${inr(r.income.high)}` : t("no_plan_yet")} />
      </div>
      <div className="mt-3 rounded-xl bg-[var(--brand)] p-3 text-white">
        <div className="text-xs opacity-80">{t("payback")} ({t("median")})</div>
        <div className="text-xl font-bold">{paybackText(t, r.payback.median, data)}</div>
        {r.payback.median?.month_from_start != null && <div className="text-xs opacity-80">{t("month_from_start", { m: r.payback.median.month_from_start })}</div>}
        <div className="mt-1 text-xs opacity-90">{t("low")}: {paybackText(t, r.payback.low, data)}</div>
      </div>
      {r.baseline_monthly > 0 && <p className="mt-2 text-xs text-[var(--muted)]">Gain measured against daily-wage work: {inr(r.baseline_monthly)}{t("per_month")} (PLFS casual wage × {A(data, "working_days_per_month")} days)</p>}
      <div className="mt-2 space-y-0.5">
        {r.income && <div className="text-xs text-[var(--muted)]">{t("income_note")}: {r.income.text}{r.income.derived ? ` · low/high = ×${A(data, "income_low_factor")}/×${A(data, "income_high_factor")} (Assumptions)` : ""}</div>}
        <div><Source url={r.career.sources?.[0]} label={r.career.income_type} date={r.career.last_checked} /></div>
        <div className="text-xs text-[var(--muted)]">Fees: {r.plan.status}</div>
      </div>
    </Card>
  );
}

export function WhatIf({ r, opts, setOpts }: { r: any; opts: PlanOptions; setOpts: (o: PlanOptions) => void }) {
  const { t, data } = useApp();
  const maxKm = A(data, "max_commute_slider_km", 60);
  const chosen = new Set(r.scholarship.chosen);
  const anyOn = r.scholarship.chosen.length > 0;
  return (
    <Card>
      <h2 className="mb-3 text-lg font-bold">🔀 {t("what_if")}</h2>
      <label className="flex items-center justify-between py-2">
        <span>{t("scholarship_toggle")}</span>
        <input type="checkbox" className="h-6 w-6" checked={anyOn} disabled={!r.scholarship.options.length}
          onChange={(e) => setOpts({ ...opts, scholarships: e.target.checked ? null : [] })} />
      </label>
      {r.scholarship.options.length > 0 && (
        <div className="mb-2 space-y-1 rounded-lg bg-[var(--bg)] p-2 text-sm">
          <div className="text-xs text-[var(--muted)]">{t("choose_scholarship")}{!A(data, "stack_scholarships") ? ` · ${t("best_only")}` : ""}</div>
          {r.scholarship.options.map((o: any) => (
            <label key={o.id} className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={chosen.has(o.id)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? (A(data, "stack_scholarships") ? [...r.scholarship.chosen, o.id] : [o.id])
                    : r.scholarship.chosen.filter((x: string) => x !== o.id);
                  setOpts({ ...opts, scholarships: next });
                }} />
              <span className="flex-1">{o.name} <span className="text-[var(--muted)]">· {inr(o.value.low)}{o.value.high > o.value.low ? `–${inr(o.value.high)}` : ""}</span>
                {o.status === "eligible_missing_docs" && <Badge tone="amber">{o.missing_docs.map((m: any) => docLabel(m.doc)).join(", ")}</Badge>}
              </span>
            </label>
          ))}
        </div>
      )}
      <label className="block py-2">
        <div className="flex justify-between"><span>{t("commute_km")}</span><b>{r.inputs.commute_km} km</b></div>
        <input type="range" min={0} max={maxKm} step={1} className="w-full" disabled={r.inputs.hostel}
          value={r.inputs.commute_km} onChange={(e) => setOpts({ ...opts, commute_km: Number(e.target.value) })} />
      </label>
      <label className="flex items-center justify-between py-2">
        <span>{t("stay_in_hostel")} <span className="text-xs text-[var(--muted)]">({inr(A(data, "hostel_cost_per_month"))}{t("per_month")})</span></span>
        <input type="checkbox" className="h-6 w-6" checked={!!opts.hostel} onChange={(e) => setOpts({ ...opts, hostel: e.target.checked })} />
      </label>
      <label className="block py-2">
        <div className="flex justify-between"><span>{t("family_contribution")}</span><b>{inr(opts.family_contribution ?? 0)}</b></div>
        <input type="range" min={0} max={5000} step={250} className="w-full"
          value={opts.family_contribution ?? 0} onChange={(e) => setOpts({ ...opts, family_contribution: Number(e.target.value) })} />
        <div className="text-sm">{t("money_to_arrange")}: <b className={r.family_gap > 0 ? "text-[var(--bad)]" : "text-[var(--good)]"}>{inr(r.family_gap)}</b></div>
      </label>
      {data.baseline && (
        <label className="flex items-center justify-between py-2">
          <span className="pr-2">{t("compare_daily_wage")}</span>
          <input type="checkbox" className="h-6 w-6" checked={opts.baseline === "daily_wage"}
            onChange={(e) => setOpts({ ...opts, baseline: e.target.checked ? "daily_wage" : "student" })} />
        </label>
      )}
    </Card>
  );
}

const COLORS = SERIES;

export function CashChart({ results, height = 240 }: { results: any[]; height?: number }) {
  const { t } = useApp();
  const maxBreak = Math.max(...results.map((r) => r.payback.median?.month_from_start ?? r.plan.course_months + 12));
  const horizon = Math.min(results[0].series.length - 1, Math.max(36, Math.ceil((maxBreak + 12) / 12) * 12));
  const rows = Array.from({ length: horizon + 1 }, (_, m) => {
    const o: any = { month: m };
    results.forEach((r, i) => { o[`p${i}`] = r.series[m]?.median; o[`l${i}`] = r.series[m]?.low; });
    return o;
  });
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} interval={11} label={{ value: t("months"), position: "insideBottomRight", offset: -2, fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={(v) => (Math.abs(v) >= 100000 ? `${(v / 100000).toFixed(1)}L` : `${Math.round(v / 1000)}k`)} />
          <Tooltip formatter={(v: any) => inr(Number(v))} labelFormatter={(m) => `${t("months")}: ${m}`} />
          <ReferenceLine y={0} stroke="#888" />
          {results.map((r, i) => r.payback.median?.month_from_start != null && (
            <ReferenceLine key={`b${i}`} x={r.payback.median.month_from_start} stroke={COLORS[i]} strokeDasharray="4 3"
              label={{ value: t("break_even"), fontSize: 10, fill: COLORS[i], position: i === 0 ? "insideTopLeft" : "insideTopRight" }} />
          ))}
          {results.map((r, i) => (
            <Area key={`l${i}`} dataKey={`l${i}`} name={`${r.plan.label} (${t("low")})`} stroke="none" fill={COLORS[i]} fillOpacity={0.08} type="monotone" />
          ))}
          {results.map((r, i) => (
            <Line key={`p${i}`} dataKey={`p${i}`} name={r.plan.label} stroke={COLORS[i]} strokeWidth={2.5} dot={false} type="monotone" />
          ))}
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SchemeResult({ e, open = false, tag }: { e: any; open?: boolean; tag?: string }) {
  const { t, data } = useApp();
  const scheme = data.scholarships.find((s: any) => s.id === e.id);
  const icon: Record<string, string> = { pass: "✅", fail: "❌", unknown: "❔", missing_doc: "📄" };
  return (
    <details className="rounded-xl bg-[var(--bg)] p-3" open={open}>
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-2">
          <div className="font-semibold">{e.name}</div>
          <Badge tone={STATUS_TONE[e.status]}>{t(e.status)}</Badge>
        </div>
        <div className="mt-1 text-xs text-[var(--muted)]">{t("rules_met", { p: e.passed, t: e.total })} · {e.amount_text}</div>
        {tag && <div className="mt-1"><Badge tone="blue">{tag}</Badge></div>}
      </summary>
      <ul className="mt-2 space-y-1 text-sm">
        {e.rules.map((r: any, i: number) => (
          <li key={i} className="flex gap-2"><span>{icon[r.status]}</span>
            <span>{r.label}{r.status === "missing_doc" && r.doc ? <span className="text-[var(--muted)]"> · {docLabel(r.doc)}</span> : null}</span></li>
        ))}
      </ul>
      {e.missing_docs.length > 0 && (
        <div className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-950">
          {e.missing_docs.map((m: any) => (
            <div key={m.doc}>📄 <b>{t("missing_document")}:</b> {docLabel(m.doc)} · <b>{t("where_to_get")}:</b> {m.where}</div>
          ))}
        </div>
      )}
      {scheme?.rules_text && <p className="mt-2 text-xs text-[var(--muted)]">{scheme.rules_text}</p>}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Source url={e.source} date={e.last_checked} />
        <a className="text-sm font-medium text-[var(--brand-ink)] underline" href={e.source} target="_blank" rel="noreferrer">{e.apply_via}</a>
      </div>
    </details>
  );
}

export function parentMessage(lang: string, profile: any, r: any, data: any) {
  const name = profile.name;
  const path = r.plan.label;
  const net = inr(Math.max(0, r.net_cost));
  const sch = r.scholarship.low > 0 ? inr(r.scholarship.low) : null;
  const inc = r.income ? inr(r.income.median) : null;
  const p = r.payback.median;
  const yrs = Math.round((r.plan.course_months / 12) * 10) / 10;
  const docs = [...new Set(r.scholarship.options.flatMap((o: any) => r.scholarship.chosen.includes(o.id) ? o.missing_docs.map((m: any) => docLabel(m.doc)) : []))];
  const pay = p?.months_after_training == null ? null : p.months_after_training;
  void data;
  if (lang === "mr") {
    return `आई-बाबा, मी ${name}. मला ${path} करायचे आहे. हे ${yrs} वर्षांचे शिक्षण आहे.` +
      (sch ? ` शिष्यवृत्तीमुळे ${sch} मिळू शकतात.` : "") +
      ` आपला निव्वळ खर्च सुमारे ${net} आहे.` + (inc ? ` नोकरी लागल्यावर साधारण ${inc} महिना मिळू शकतात.` : "") +
      (pay != null ? (pay === 0 ? " प्रशिक्षण संपेपर्यंतच खर्च भरून निघतो." : ` खर्च ${pay} महिन्यांत परत मिळेल.`) : "") +
      (docs.length ? ` त्यासाठी ${docs.join(", ")} काढावे लागेल, तहसील कार्यालय किंवा आपले सरकार केंद्रात मिळते.` : "");
  }
  if (lang === "hi") {
    return `माँ-पापा, मैं ${name}. मैं ${path} करना चाहती/चाहता हूँ। यह ${yrs} साल की पढ़ाई है।` +
      (sch ? ` छात्रवृत्ति से ${sch} मिल सकते हैं।` : "") +
      ` हमारा शुद्ध खर्च लगभग ${net} है।` + (inc ? ` नौकरी लगने पर लगभग ${inc} महीना मिल सकता है।` : "") +
      (pay != null ? (pay === 0 ? " प्रशिक्षण खत्म होने तक खर्च वसूल हो जाता है।" : ` खर्च ${pay} महीनों में वसूल होगा।`) : "") +
      (docs.length ? ` इसके लिए ${docs.join(", ")} बनवाना होगा, तहसील कार्यालय में मिलता है।` : "");
  }
  return `Hi Aai-Baba, it's ${name}. I want to do ${path}. It is ${yrs} years of study.` +
    (sch ? ` A scholarship can give ${sch}.` : "") + ` Our net cost is about ${net}.` +
    (inc ? ` After I start working I can earn about ${inc} a month.` : "") +
    (pay != null ? (pay === 0 ? " The cost is paid back by the end of training." : ` The cost pays back in ${pay} months.`) : "") +
    (docs.length ? ` We need to get the ${docs.join(", ")} from the tehsil office or Aaple Sarkar centre.` : "");
}

export function ParentNote({ r }: { r: any }) {
  const { t, lang, profile, data } = useApp();
  const msg = parentMessage(lang, profile, r, data);
  return (
    <Card>
      <h2 className="mb-2 text-lg font-bold">👪 {t("parent_message")}</h2>
      <p className="rounded-xl bg-[var(--bg)] p-3 text-sm leading-relaxed">{msg}</p>
      <div className="mt-3 flex gap-2">
        <SpeakButton text={msg} />
        <a className="inline-flex items-center gap-1 rounded-full bg-[#25D366] px-3 py-1.5 text-sm font-medium text-white"
          href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer">💬 {t("share_whatsapp")}</a>
      </div>
      <VoiceNote text={msg} name={profile?.name} />
    </Card>
  );
}
