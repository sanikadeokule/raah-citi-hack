"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Card, Shell, Stat } from "@/components/ui";
import { inr } from "@/lib/engine";
import { useApp } from "@/lib/store";

export default function TeacherPayoutHistory() {
  const { t, authFetch } = useApp();
  const [batches, setBatches] = useState<any[] | null>(null);
  const [earnings, setEarnings] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [historyRes, earningsRes] = await Promise.all([
        authFetch("/api/modules/payouts"), authFetch("/api/modules/earnings"),
      ]);
      const [history, summary] = await Promise.all([historyRes.json(), earningsRes.json()]);
      if (!historyRes.ok || !earningsRes.ok) throw new Error("Could not load payout history");
      setBatches(history); setEarnings(summary); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load payout history"); setBatches([]); }
  }, [authFetch]);
  useEffect(() => { load(); }, [load]);

  return (
    <Shell title={t("teacher_payout_history")} role="teacher">
      <Link href="/teacher/" className="text-sm font-semibold text-[var(--brand-ink)] underline">← {t("teacher_dashboard")}</Link>
      {earnings && <div className="grid grid-cols-3 gap-2">
        <Stat label={t("earnings")} value={inr(earnings.total)} />
        <Stat label={t("unpaid")} value={inr(earnings.unpaid)} tone="text-[var(--good)]" />
        <Stat label={t("progress_completed")} value={String(earnings.completions)} />
      </div>}
      {error && <Card><p className="text-sm text-rose-800">{error}</p><button onClick={load} className="mt-2 text-sm underline">{t("teacher_retry")}</button></Card>}
      {batches?.length === 0 && !error && <Card><p className="text-sm text-[var(--muted)]">{t("payout_no_history")}</p></Card>}
      {batches?.map((batch) => (
        <Card key={batch.reference}>
          <div className="flex items-start justify-between gap-2">
            <div><h2 className="font-bold">{inr(batch.amount)}</h2><p className="text-xs text-[var(--muted)]">{new Date(batch.created_at * 1000).toLocaleString()}</p></div>
            <Badge tone={batch.status === "processed" || batch.status === "credited" ? "green" : "amber"}>{batch.status}</Badge>
          </div>
          <p className="mt-2 break-all text-xs text-[var(--muted)]">{batch.provider} · {batch.reference}</p>
          <p className="mt-1 text-xs">{batch.enrolments} {t("payout_enrolments")}</p>
          {!!batch.items?.length && <ul className="mt-2 divide-y divide-black/5">
            {batch.items.map((item: any, i: number) => (
              <li key={`${item.module}-${i}`} className="flex items-start justify-between gap-2 py-1.5 text-xs">
                <span>{item.module}<span className="block text-[var(--muted)]">{t("module_sales")}: {inr(item.teacher_share)} · {t("completions_label", { n: 1 })}: {inr(item.completion_payout)}</span></span>
                <b>{inr(item.teacher_share + item.completion_payout)}</b>
              </li>
            ))}
          </ul>}
        </Card>
      ))}
    </Shell>
  );
}
