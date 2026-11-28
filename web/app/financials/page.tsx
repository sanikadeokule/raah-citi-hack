"use client";
// Financial aid calculator (Raah Pro). Course fee, length, family income and scholarships in;
// net cost, education-loan eligibility, EMI and a payback timeline against the first job's pay out.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Icon } from "@/components/icon";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card, Shell, Source } from "@/components/ui";
import { ProBadge, ProGate, useText } from "@/components/pro";
import { inr } from "@/lib/engine";
import { LOAN_RULES, LOAN_SOURCES, computeAid, defaultsFor, matchingScholarships, type AidInput } from "@/lib/finance";
import { useApp } from "@/lib/store";


type Tab = "inputs" | "cost" | "loan" | "emi" | "payback";
const TAB_ICON: Record<Tab, string> = { inputs: "pencil", cost: "receipt", loan: "bank", emi: "calendar", payback: "hourglass" };
const TENURES = [5, 7, 10, 15];

function Slider({ label, value, display, min, max, step, onChange }: {
  label: string; value: number; display: string; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-[var(--muted)]">{label}</span>
        <span className="font-bold text-[var(--brand-ink)]">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full" />
    </label>
  );
}

function Calculator() {
  const { data, profile, lang } = useApp();
  const t = useText("fin_");
  const careers = useMemo(() => [...(data?.careers || [])].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))), [data]);
  const startCareer: string | null = profile?.roadmap_career || careers[0]?.id || null;
  const d0 = useMemo(() => defaultsFor(data, profile, startCareer), [data, profile, startCareer]);
  const [inp, setInp] = useState<AidInput>({
    ...d0, scholarship_ids: [], other_scholarship_per_year: 0, career_id: startCareer, rate_pct: 10.5, tenure_years: 10,
  });
  const set = (p: Partial<AidInput>) => setInp((x) => ({ ...x, ...p }));
  const [tab, setTab] = useState<Tab>("inputs");

  const matches = useMemo(() => matchingScholarships(data, profile || {}, inp.family_income), [data, profile, inp.family_income]);
  // tick the scholarships that match; untick any that stop matching when the income changes
  const matchKey = matches.map((s: any) => s.id).join(",");
  useEffect(() => { set({ scholarship_ids: matches.map((s: any) => s.id) }); }, [matchKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const aid = useMemo(() => computeAid(data, profile || {}, inp), [data, profile, inp]);
  const L = aid.loan;
  const year0 = new Date().getFullYear();
  const yearsLabel = (n: number) => (n === 1 ? t("year_1") : t("years_n", { n }));
  const lakh = (v: number) => (v >= 100000 ? `₹${(v / 100000).toFixed(v % 100000 ? 1 : 0)} lakh` : inr(v));
  const affordTone = { comfortable: "green", tight: "amber", heavy: "red", unknown: "gray" } as const;
  const sharePct = aid.emi_share === null ? null : Math.round(aid.emi_share * 100);
  const barMax = Math.max(aid.course_cost, 1);
  const order: Tab[] = L.needed ? ["inputs", "cost", "loan", "emi", "payback"] : ["inputs", "cost"];
  const active: Tab = order.includes(tab) ? tab : "cost";
  const nextBtn = (cur: Tab) => {
    const n = order[order.indexOf(cur) + 1];
    return n ? <button onClick={() => setTab(n)} className="w-full rounded-xl bg-[var(--brand)] py-3 text-sm font-semibold text-white">{t("next")}: {TAB_ICON[n]} {t(`tab_${n}`)} →</button> : null;
  };
  const schShown = aid.scholarships.filter((s) => inp.scholarship_ids.includes(s.id));
  const best = aid.stacked ? null : schShown.reduce((a: any, s) => (!a || s.value > a.value ? s : a), null);

  return (
    <>
      {/* one row of tabs: your numbers, then the cost, then the loan, its EMI and the payback */}
      <div className="flex gap-1 rounded-2xl bg-[var(--card)] p-1 ring-1 ring-[var(--border)]" role="tablist">
        {order.map((k) => (
          <button key={k} role="tab" aria-selected={active === k} onClick={() => setTab(k)}
            className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-semibold leading-tight ${active === k ? "bg-[var(--brand)] text-white" : "text-[var(--muted)]"}`}>
            <Icon name={TAB_ICON[k]} size={18} />
            <span className="max-w-full truncate">{t(`tab_${k}`)}</span>
          </button>
        ))}
      </div>
      <Card className="!bg-gradient-to-br from-[var(--brand)] to-[#0f2547] text-white">
        <div className="flex items-center gap-2"><ProBadge /><span className="text-xs text-white/80">{t("title")}</span></div>
        <h2 className="mt-2 text-xl font-bold leading-tight">{t("hero")}</h2>
        <p className="mt-1 text-sm text-white/80">{t("hero_sub")}</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            { k: t("net"), v: lakh(aid.net_cost) },
            { k: t("emi_title"), v: L.needed ? inr(L.emi) : "₹0" },
            { k: t("repay"), v: L.needed ? (aid.fast_payback_months !== null ? `${aid.fast_payback_months} ${t("month_short")}` : t("over_15_years")) : "—" },
          ].map((x) => (
            <div key={x.k} className="rounded-xl bg-white/10 px-1 py-2">
              <div className="text-lg font-bold leading-tight">{x.v}</div>
              <div className="truncate text-[11px] text-white/75">{x.k}</div>
            </div>
          ))}
        </div>
      </Card>

      {active === "inputs" && (
      <Card className="space-y-4">
        <h3 className="font-bold">{t("inputs")}</h3>
        <Slider label={t("fee")} value={inp.fee_per_year} display={inr(inp.fee_per_year)} min={0} max={500000} step={5000} onChange={(v) => set({ fee_per_year: v })} />
        <Slider label={t("years")} value={inp.years} display={yearsLabel(inp.years)} min={1} max={6} step={1} onChange={(v) => set({ years: v })} />
        <Slider label={t("income")} value={inp.family_income} display={inr(inp.family_income)} min={0} max={1500000} step={10000} onChange={(v) => set({ family_income: v })} />
        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("career")}</span>
          <select value={inp.career_id ?? ""} onChange={(e) => set({ career_id: e.target.value || null })}
            className="mt-1 w-full rounded-lg bg-[var(--bg)] p-2 text-sm">
            {careers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div>
          <div className="text-sm text-[var(--muted)]">{t("sch")}</div>
          {!matches.length ? <p className="mt-1 text-xs text-[var(--muted)]">{t("sch_none")}</p> : (
            <ul className="mt-1 space-y-1">
              {matches.map((s: any) => {
                const on = inp.scholarship_ids.includes(s.id);
                const v = aid.scholarships.find((x) => x.id === s.id);
                return (
                  <li key={s.id}>
                    <label className={`flex items-start gap-2 rounded-lg p-2 text-sm ${on ? "bg-emerald-50 ring-1 ring-emerald-300 dark:bg-emerald-900/20" : "bg-[var(--bg)]"}`}>
                      <input type="checkbox" checked={on} className="mt-1"
                        onChange={() => set({ scholarship_ids: on ? inp.scholarship_ids.filter((x) => x !== s.id) : [...inp.scholarship_ids, s.id] })} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium leading-snug">{s.name}</span>
                        <span className="block text-xs text-[var(--muted)]">{s.amount_text}</span>
                      </span>
                      {v && on && <span className={`shrink-0 text-xs font-bold ${best && best.id !== s.id ? "text-[var(--muted)] line-through" : "text-[var(--good)]"}`}>{inr(v.value)}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {!aid.stacked && schShown.length > 1 && <p className="mt-1 text-[11px] text-[var(--muted)]">{t("sch_best")}</p>}
          <label className="mt-2 flex items-center justify-between gap-2 text-sm">
            <span className="text-[var(--muted)]">{t("sch_other")}</span>
            <input type="number" min={0} step={1000} value={inp.other_scholarship_per_year || ""} placeholder="0"
              onChange={(e) => set({ other_scholarship_per_year: Math.max(0, Number(e.target.value) || 0) })}
              className="w-28 rounded-lg bg-[var(--bg)] p-2 text-right text-sm" />
          </label>
        </div>
      </Card>
      )}
      {active === "inputs" && nextBtn("inputs")}

      {active === "cost" && (
      <Card>
        <h3 className="font-bold">{t("net")}</h3>
        <div className="mt-3 space-y-2 text-sm">
          {[
            { k: t("cost"), v: aid.course_cost, cls: "bg-slate-400" },
            { k: t("minus_sch"), v: aid.scholarship_total, cls: "bg-emerald-500", neg: true },
            { k: t("net"), v: aid.net_cost, cls: "bg-[var(--accent)]", strong: true },
          ].map((r) => (
            <div key={r.k}>
              <div className="flex justify-between"><span className={r.strong ? "font-bold" : ""}>{r.k}</span>
                <span className={`font-bold ${r.neg ? "text-[var(--good)]" : ""}`}>{r.neg && r.v ? "− " : ""}{inr(r.v)}</span></div>
              <div className="mt-1 h-3 rounded-full bg-[var(--bg)]"><div className={`h-3 rounded-full ${r.cls}`} style={{ width: `${Math.max(r.v ? 2 : 0, (r.v / barMax) * 100)}%` }} /></div>
            </div>
          ))}
        </div>
        {!L.needed && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-center text-sm font-semibold text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200">{t("covered")}</p>}
      </Card>
      )}
      {active === "cost" && nextBtn("cost")}

        {L.needed && active === "loan" && (
        <Card>
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold">{t("loan_title")}</h3>
            <Badge tone={L.security === "collateral" ? "amber" : "green"}>{L.security === "collateral" ? "⚠" : "✓"} {lakh(L.amount)}</Badge>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-[var(--bg)] p-2.5"><dt className="text-xs text-[var(--muted)]">{t("loan_amount")}</dt><dd className="font-bold">{inr(L.amount)}</dd></div>
            <div className="rounded-xl bg-[var(--bg)] p-2.5"><dt className="text-xs text-[var(--muted)]">{t("margin")} · {L.margin_pct}%</dt><dd className="font-bold">{inr(L.margin)}</dd></div>
          </dl>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex gap-2"><Icon name={L.security === "collateral" ? "home" : "check"} size={16} /><span>{t(`sec_${L.security}`)}</span></li>
            <li className="flex gap-2"><Icon name={L.csis || L.vidyalaxmi ? "gift" : "info"} size={16} /><span>{L.csis ? t("csis") : L.vidyalaxmi ? t("vidyalaxmi") : t("no_sub")}</span></li>
          </ul>
        </Card>
        )}
        {active === "loan" && nextBtn("loan")}

        {L.needed && active === "emi" && (
        <Card>
          <h3 className="font-bold">{t("emi_title")}</h3>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-3xl font-extrabold text-[var(--brand-ink)]">{inr(L.emi)}</span>
            <span className="pb-1 text-xs text-[var(--muted)]">{t("per_month")}</span>
          </div>
          <p className="text-xs text-[var(--muted)]">{t("emi_for", { n: inp.tenure_years, m: L.moratorium_months })}</p>
          <div className="mt-3 flex gap-1.5">
            {TENURES.map((n) => (
              <button key={n} onClick={() => set({ tenure_years: n })}
                className={`flex-1 rounded-lg py-1.5 text-sm font-semibold ${inp.tenure_years === n ? "bg-[var(--brand)] text-white" : "bg-[var(--bg)]"}`}>{yearsLabel(n)}</button>
            ))}
          </div>
          <div className="mt-3"><Slider label={t("rate")} value={inp.rate_pct} display={`${inp.rate_pct.toFixed(1)}%`} min={8} max={14} step={0.5} onChange={(v) => set({ rate_pct: v })} /></div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-[var(--bg)] p-2.5"><div className="text-xs text-[var(--muted)]">{t("study_interest")}</div><div className="font-bold">{inr(L.interest_full)}</div>
              {L.subsidy > 0 && <div className="text-[11px] text-[var(--good)]">− {inr(L.subsidy)} {t("saved")}</div>}</div>
            <div className="rounded-xl bg-[var(--bg)] p-2.5"><div className="text-xs text-[var(--muted)]">{t("added")}</div><div className="font-bold">{inr(L.moratorium_interest)}</div></div>
            <div className="rounded-xl bg-[var(--bg)] p-2.5"><div className="text-xs text-[var(--muted)]">{t("total_interest")}</div><div className="font-bold">{inr(L.total_interest)}</div></div>
            <div className="rounded-xl bg-[var(--bg)] p-2.5"><div className="text-xs text-[var(--muted)]">{t("salary")}{aid.job?.estimate ? ` (${t("estimate")})` : ""}</div>
              <div className="font-bold">{aid.job?.salary ? `${inr(aid.job.salary)}/${t("month_short")}` : "—"}</div></div>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between text-sm">
              <span>{sharePct === null ? t("unknown") : <><b>{sharePct}%</b> {t("of_salary")}</>}</span>
              <Badge tone={affordTone[aid.affordability as keyof typeof affordTone]}>{t(aid.affordability)}</Badge>
            </div>
            {sharePct !== null && <>
              <div className="relative mt-1 h-3 overflow-hidden rounded-full bg-gradient-to-r from-emerald-300 via-amber-300 to-rose-400">
                <div className="absolute top-0 h-3 w-1 rounded bg-[var(--ink)]" style={{ left: `${Math.min(98, sharePct / 0.6)}%` }} />
              </div>
              <div className="mt-0.5 flex justify-between text-[10px] text-[var(--muted)]"><span>0%</span><span>20%</span><span>35%</span><span>60%+</span></div>
              <p className="mt-1 text-xs text-[var(--muted)]">{t(`afford_${aid.affordability}`)}</p>
            </>}
          </div>
          {aid.job && <div className="mt-1"><Source url={aid.job.source} label={aid.job.career} /></div>}
        </Card>
        )}
        {active === "emi" && nextBtn("emi")}

        {L.needed && active === "payback" && (
        <Card>
          <h3 className="font-bold">{t("timeline")}</h3>
          {(() => {
            const total = aid.loan_free_after_months;
            const seg = [
              { k: t("study"), m: L.course_months, cls: "bg-sky-500" },
              { k: t("grace"), m: LOAN_RULES.moratorium_extra_months, cls: "bg-amber-400" },
              { k: t("repay"), m: L.tenure_months, cls: "bg-[var(--brand)]" },
            ];
            return (<>
              <div className="mt-3 flex h-7 overflow-hidden rounded-full text-[10px] font-semibold text-white">
                {seg.map((s) => <div key={s.k} className={`${s.cls} grid place-items-center`} style={{ width: `${(s.m / total) * 100}%` }}>{s.m >= 10 ? `${s.m}m` : ""}</div>)}
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-xs">
                {seg.map((s) => <span key={s.k} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${s.cls}`} />{s.k} · {s.m} {t("month_short")}</span>)}
              </div>
              <p className="mt-2 rounded-xl bg-[var(--brand-soft)] p-2.5 text-center text-sm font-semibold text-[var(--brand-ink)]">{t("free", { y: year0 + Math.ceil(total / 12) })}</p>
            </>);
          })()}
          <div className="mt-3 h-40">
            <ResponsiveContainer>
              <AreaChart data={aid.balance} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs><linearGradient id="owed" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity={0.5} /><stop offset="100%" stopColor="#2563eb" stopOpacity={0.05} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={44} tickFormatter={(v) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : `${Math.round(v / 1000)}k`)} />
                <Tooltip formatter={(v: any) => [inr(Number(v)), t("owed")]} labelFormatter={(m) => `${m} ${t("months_after")}`} />
                <Area type="monotone" dataKey="owed" stroke="#2563eb" fill="url(#owed)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-sm">{aid.fast_payback_months !== null ? t("fast", { m: aid.fast_payback_months }) : t("fast_none")}</p>
        </Card>
        )}
        {active === "payback" && nextBtn("payback")}

      <Card className="space-y-2">
        <a href={LOAN_SOURCES[0].url} target="_blank" rel="noreferrer" className="block rounded-xl bg-[var(--brand)] py-3 text-center font-semibold text-white">{t("apply")} </a>
        <p className="text-xs text-[var(--muted)]">{t("note")}</p>
        <p className="text-xs text-[var(--muted)]">{t("rules")}: {LOAN_SOURCES.map((s, i) => <span key={s.url}>{i ? " · " : ""}<a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.label}</a></span>)}</p>
        <span className="hidden">{lang}</span>
      </Card>
    </>
  );
}

export default function FinancialsPage() {
  const t = useText("fin_");
  return (
    <Shell title={t("title")}>
      <ProGate><Calculator /></ProGate>
    </Shell>
  );
}
