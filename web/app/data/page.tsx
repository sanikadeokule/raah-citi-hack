"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Badge, Card, Shell } from "@/components/ui";
import { useApp } from "@/lib/store";

export default function DataPage() {
  const { data, t, refresh } = useApp();
  const counts: [string, number][] = [
    [t("data_scholarships"), data?.scholarships.length], [t("data_rules"), data?.scholarships.reduce((a: number, s: any) => a + s.rules.length, 0)],
    [t("data_careers"), data?.careers.length], [t("data_plans"), data?.plans.length], [t("data_centres"), data?.centres.length],
    [t("data_naps"), data?.naps.length], [t("data_railway"), data?.railway.length], [t("data_courses"), data?.courses.length], [t("data_exams"), data?.exams?.length],
  ];
  return (
    <Shell title={t("home_data")} publicPage>
      <Card>
        <h2 className="font-bold">{t("live_data")}</h2>
        <p className="mt-1 text-sm">{data?.version.file} · {data && t("data_saved", { date: new Date(data.version.modified).toLocaleString() })}</p>
        <p className="text-xs text-[var(--muted)]">{t("data_intro")}</p>
        <button onClick={refresh} className="mt-2 rounded-full bg-[var(--brand-soft)] px-3 py-1 text-sm">↻ {t("data_reload")}</button>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          {counts.map(([k, v]) => <div key={k} className="rounded-lg bg-[var(--bg)] p-2">{k}<div className="text-lg font-bold">{v}</div></div>)}
        </div>
      </Card>
      <Card>
        <h2 className="font-bold">{t("warnings")} <Badge>{data?.warnings.length}</Badge></h2>
        <ul className="mt-1 list-disc pl-5 text-sm">{data?.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
      </Card>
      <Card>
        <h2 className="font-bold">{t("assumptions")}</h2>
        <table className="mt-2 w-full text-sm"><tbody>
          {data && Object.entries(data.assumptions).map(([k, a]: any) => (
            <tr key={k} className="border-b border-black/5 align-top">
              <td className="py-1 pr-2"><code className="text-xs">{k}</code><div className="text-xs text-[var(--muted)]">{a.note}</div></td>
              <td className="py-1 text-right font-semibold">{a.value} <span className="text-xs font-normal text-[var(--muted)]">{a.unit}</span></td>
            </tr>
          ))}
        </tbody></table>
      </Card>
      <Card>
        <h2 className="font-bold"> README</h2>
        <ul className="mt-1 space-y-1 text-xs text-[var(--muted)]">{data?.readme.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
      </Card>
    </Shell>
  );
}
