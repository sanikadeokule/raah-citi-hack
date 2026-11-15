"use client";
// Mentors from the spreadsheet, filtered by career and distance. A mentor's phone number
// comes from the server only after the student agrees to share their first name, class and taluka.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { Badge, Card } from "./ui";
import { haversine, rankCareers } from "@/lib/engine";
import { useApp } from "@/lib/store";

export function Mentors() {
  const { data, profile, t, authFetch, online, auth } = useApp();
  const top = useMemo(() => (data && profile ? rankCareers(data, profile, 5).map((s: any) => s.career.id) : []), [data, profile]);
  const [career, setCareer] = useState<string>("top");
  const [maxKm, setMaxKm] = useState(60);
  const [asking, setAsking] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth?.user.role !== "student" || !online) return;
    authFetch("/api/mentors/mine").then((r) => (r.ok ? r.json() : [])).then((rows: any[]) =>
      setContacts(Object.fromEntries(rows.map((m) => [m.mentor_id, m.contact?.phone])))).catch(() => {});
  }, [auth, authFetch, online]);

  const careers = data?.careers || [];
  const list = (data?.mentors || [])
    .map((m: any) => ({ ...m, km: profile?.lat && m.lat ? haversine(profile.lat, profile.lon, m.lat, m.lon) : null }))
    .filter((m: any) => (career === "all" ? true : career === "top" ? m.career_ids.some((c: string) => top.includes(c)) : m.career_ids.includes(career)))
    .filter((m: any) => m.km === null || m.km <= maxKm)
    .sort((a: any, b: any) => (a.km ?? 999) - (b.km ?? 999));

  const accept = async (id: string) => {
    setError(null);
    const r = await authFetch(`/api/mentors/${id}/request`, { method: "POST", body: JSON.stringify({ accept_sharing: true, name: profile?.name, class: profile?.class, taluka: profile?.taluka }) });
    const j = await r.json();
    if (!r.ok) { setError(typeof j.detail === "string" ? j.detail : "Error"); return; }
    setContacts((c) => ({ ...c, [id]: j.contact?.phone }));
    setAsking(null);
  };

  return (
    <Card>
      <h2 className="mb-2 font-bold">🤝 {t("mentors")} <Badge>{list.length}</Badge></h2>
      <div className="grid gap-2 text-sm">
        <select value={career} onChange={(e) => setCareer(e.target.value)} className="w-full min-w-0 rounded-lg bg-[var(--bg)] p-2">
          <option value="top">{t("mentors_top_careers")}</option>
          <option value="all">{t("mentors_all")}</option>
          {careers.filter((c: any) => (data?.mentors || []).some((m: any) => m.career_ids.includes(c.id))).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="flex items-center gap-2">{t("within_km", { km: maxKm })}
          <input type="range" min={5} max={100} step={5} value={maxKm} onChange={(e) => setMaxKm(Number(e.target.value))} className="flex-1" />
        </label>
      </div>
      <ul className="mt-2 space-y-2">
        {list.map((m: any) => (
          <li key={m.id} className="rounded-xl bg-[var(--bg)] p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div><b>{m.name}</b><div className="text-xs text-[var(--muted)]">{m.works_as}</div></div>
              <span className="whitespace-nowrap text-xs text-[var(--muted)]">{m.taluka}{m.km !== null ? ` · ~${Math.round(m.km)} km` : ""}</span>
            </div>
            <div className="mt-1">💬 {m.helps_with}</div>
            <div className="text-xs text-[var(--muted)]">🗣️ {m.languages.join(", ")} · {m.mode} · {m.available}</div>
            {m.note && <div className="mt-1"><Badge tone="amber">{m.note}</Badge></div>}
            {contacts[m.id] ? (
              <a href={`tel:${contacts[m.id].replace(/\s/g, "")}`} className="mt-2 block rounded-lg bg-[var(--good,#138808)] py-2 text-center font-semibold text-white">📞 {contacts[m.id]}</a>
            ) : asking === m.id ? (
              <div className="mt-2 rounded-lg bg-[var(--card)] p-2 ring-1 ring-black/10">
                <p className="text-xs">{t("mentor_consent", { name: m.name })}</p>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => accept(m.id)} className="flex-1 rounded-lg bg-[var(--brand)] py-2 text-sm font-semibold text-white">{t("agree_show_number")}</button>
                  <button onClick={() => setAsking(null)} className="rounded-lg px-3 text-sm underline">{t("cancel")}</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAsking(m.id)} disabled={!online || auth?.user.role !== "student"}
                className="mt-2 w-full rounded-lg bg-[var(--brand-soft)] py-2 text-sm font-semibold text-[var(--brand-ink)] disabled:opacity-50">
                {online ? `🙋 ${t("request_mentor")}` : t("needs_internet")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{error}</p>}
    </Card>
  );
}
