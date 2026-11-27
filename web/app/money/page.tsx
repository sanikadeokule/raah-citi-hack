"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Mark } from "@/components/icon";
import { useEffect, useState } from "react";
import { Badge, Card, Shell } from "@/components/ui";
import { inr } from "@/lib/engine";
import { API, useApp } from "@/lib/store";
import { getKV } from "@/lib/db";


export default function Money() {
  const { data, profile, t, authFetch, auth } = useApp();
  const post = (u: string, b: any) => authFetch(u, { method: "POST", body: JSON.stringify(b) }).then((r) => r.json());
  const [consent, setConsent] = useState<any>(null);
  const [fi, setFi] = useState<any>(null);
  const [scheme, setScheme] = useState("");
  const [pay, setPay] = useState<any>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [passport, setPassport] = useState<any>(null);
  const cashSchemes = (data?.scholarships || []).filter((s: any) => s.benefit.per_year || s.benefit.per_month);
  useEffect(() => { if (!scheme && cashSchemes[0]) setScheme(cashSchemes[0].id); }, [cashSchemes, scheme]);
  useEffect(() => {
    if (auth?.user.role !== "teacher") return;
    const id = setInterval(() => authFetch("/api/money/ledger").then((r) => (r.ok ? r.json() : [])).then(setLedger).catch(() => {}), 3000);
    return () => clearInterval(id);
  }, [authFetch, auth]);

  const doConsent = async () => {
    const c = await post("/api/money/aa/consent", { student_id: profile.id || profile.name, declared_income_annual: profile.family_income_annual });
    setConsent(c);
    const f = await authFetch(`/api/money/aa/fi-data?consent_id=${c.consentId}`).then((r) => r.json());
    setFi(f);
  };
  const doPay = async () => {
    setPay(await post("/api/money/payments", { kind: "scholarship", scheme_id: scheme, payees: [{ name: profile.name, account: "50100" + String(Math.abs(hash(profile.name))).slice(0, 7), ifsc: fi?.FI?.Account?.Summary?.ifscCode || "SNDB0000001", student_id: profile.id || "STU" }] }));
  };
  const doPassport = async () => {
    const lessons = (await getKV<string[]>("lessons_done")) || [];
    const quiz = await getKV<any>("quiz_Q1");
    setPassport(await post("/api/money/passport", { student_id: profile.id || profile.name, name: profile.name, lessons: lessons.map((id) => ({ id, completed: true })), quizzes: quiz ? [quiz] : [], certificates: [] }));
  };

  return (
    <Shell title={t("money_layer")} role="teacher">
      <Card>
        <h2 className="font-bold">{t("money_bank_title")}</h2>
        <p className="text-xs text-[var(--muted)]">{t("money_bank_note")}</p>
        {!consent ? (
          <button onClick={doConsent} className="mt-2 w-full rounded-xl bg-[var(--brand)] py-3 font-semibold text-white">{t("money_consent_btn")}</button>
        ) : (
          <div className="mt-2 space-y-1 text-sm">
            <div>{t("money_consent")} <code className="text-xs">{consent.consentId.slice(0, 8)}…</code> <Badge tone="green">{consent.status}</Badge> · {t("money_purpose")} {consent.ConsentDetail.Purpose.text}</div>
            {fi && (
              <ul className="rounded-lg bg-[var(--bg)] p-2">
                <li><Mark kind={fi.analysis.account_active ? "yes" : "no"} /> {t("money_account_active", { account: fi.FI.Account.maskedAccNumber })}</li>
                <li><Mark kind={fi.analysis.income_band_matches ? "yes" : "warn"} /> {t("money_income_match", { estimate: inr(fi.analysis.estimated_income_annual), declared: inr(fi.analysis.declared_income_annual) })}</li>
                <li><Mark kind={fi.analysis.ready_for_dbt ? "yes" : "warn"} /> {t(fi.analysis.ready_for_dbt ? "money_dbt_yes" : "money_dbt_no")}</li>
              </ul>
            )}
          </div>
        )}
      </Card>
      <Card>
        <h2 className="font-bold">{t("money_payout_title")}</h2>
        <select value={scheme} onChange={(e) => setScheme(e.target.value)} className="mt-2 w-full rounded-lg bg-[var(--bg)] p-2 text-sm">
          {cashSchemes.map((s: any) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}
        </select>
        <button onClick={doPay} className="mt-2 w-full rounded-xl bg-[var(--brand)] py-3 font-semibold text-white">{t("money_generate")}</button>
        {pay && (
          <div className="mt-2 space-y-1 text-sm">
            <div>{t("money_amount", { amount: inr(pay.amount_each) })} <span className="text-xs text-[var(--muted)]">{t("money_from_scholarships", { scheme: pay.amount_source?.id ?? "", cell: pay.amount_source?.cell ?? "" })}</span></div>
            <div><Badge tone={pay.validation.valid ? "green" : "red"}>{t(pay.validation.valid ? "money_valid" : "money_invalid")}</Badge> <span className="text-xs text-[var(--muted)]">{pay.validation.method}</span></div>
            <pre className="max-h-72 overflow-auto rounded-lg bg-black p-2 text-[10px] leading-tight text-emerald-300">{pay.xml}</pre>
          </div>
        )}
        {ledger.length > 0 && (
          <table className="mt-2 w-full text-xs"><tbody>
            {ledger.slice(-5).reverse().map((l) => (
              <tr key={l.msg_id} className="border-b border-black/5"><td className="py-1">{l.msg_id}</td><td>{l.kind}</td><td>{inr(l.amount)}</td>
                <td><Badge tone={l.status === "credited" ? "green" : l.status === "accepted" ? "blue" : "gray"}>{l.status}</Badge></td></tr>
            ))}
          </tbody></table>
        )}
      </Card>
      <Card>
        <h2 className="font-bold">{t("money_passport_title")}</h2>
        <button onClick={doPassport} className="mt-2 w-full rounded-xl bg-[var(--brand)] py-3 font-semibold text-white">{t("money_issue")}</button>
        {passport && (
          <>
            <ul className="mt-2 text-sm">
              <li>{t("money_lessons", { n: passport.credentialSubject.achievements.lessons.length })}</li>
              <li>{t("money_quizzes", { scores: passport.credentialSubject.achievements.quizzes.map((q: any) => `${q.score}/${q.total}`).join(", ") || "—" })}</li>
            </ul>
            <a download="skills-passport.json" href={`data:application/json,${encodeURIComponent(JSON.stringify(passport, null, 2))}`} className="mt-2 inline-block text-sm underline">{t("money_download_json")}</a>
          </>
        )}
      </Card>
      <a href={`${API}/docs`} target="_blank" rel="noreferrer" className="block text-center text-sm underline">{t("money_partner_docs")} →</a>
    </Shell>
  );
}

function hash(s: string) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
