"use client";
// Mentors from the spreadsheet, filtered by the career picked on the page and by distance, then ranked: works in the
// student's own career (50) or a related one (25), close by (up to 30, same taluka counts as next door), speaks the
// student's language (20). Each mentor shows the reasons, so the order is never a mystery. A mentor's phone number
// comes from the server only after the student agrees to share their first name, class and taluka.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { Badge, Card } from "./ui";
import { haversine } from "@/lib/engine";
import { chosenCareers, mentorMatches, pickForCareers, type CareerChoice } from "@/lib/listings";
import { useApp } from "@/lib/store";
import { placeLabel } from "@/lib/questions";
import { RelatedNote } from "./careerfilter";
import { languageName } from "@/lib/languages";

export function Mentors({ career, top }: { career: CareerChoice; top: string[] }) {
  const { data, profile, t, authFetch, online, auth, lang } = useApp();
  const [maxKm, setMaxKm] = useState(60);
  const [asking, setAsking] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth?.user.role !== "student" || !online) return;
    authFetch("/api/mentors/mine").then((r) => (r.ok ? r.json() : [])).then((rows: any[]) =>
      setContacts(Object.fromEntries(rows.map((m) => [m.mentor_id, m.contact?.phone])))).catch(() => {});
  }, [auth, authFetch, online]);

  const nearby = useMemo(() => (data?.mentors || [])
    .map((m: any) => ({ ...m, km: profile?.lat && m.lat ? haversine(profile.lat, profile.lon, m.lat, m.lon) : null }))
    .filter((m: any) => m.km === null || m.km <= maxKm)
    .sort((a: any, b: any) => (a.km ?? 999) - (b.km ?? 999)), [data, profile, maxKm]);
  const picked = pickForCareers(data, nearby, career, top, mentorMatches);
  const speaks = languageName(lang);
  const list = useMemo(() => {
    const own = chosenCareers(data, career, top);
    return picked.items.map((m: any) => {
      const reasons: string[] = [];
      let score = 0;
      if (own.some((c: any) => mentorMatches(m, c))) { score += 50; reasons.push(t("mr_career")); }
      else if (picked.related) { score += 25; reasons.push(t("mr_related")); }
      if (profile?.taluka && m.taluka === profile.taluka) { score += 30; reasons.push(t("mr_same_taluka")); }
      else if (m.km !== null) { score += Math.max(0, 30 - m.km / 2); if (m.km <= 40) reasons.push(t("mr_near", { km: Math.round(m.km) })); }
      if ((m.languages || []).includes(speaks)) { score += 20; reasons.push(t("mr_lang", { lang: t(`langname_${speaks}`) })); }
      return { ...m, score, reasons };
    }).sort((a: any, b: any) => b.score - a.score);
  }, [picked.items, picked.related, data, career, top, profile?.taluka, speaks, t]);

  const accept = async (id: string) => {
    setError(null);
    const r = await authFetch(`/api/mentors/${id}/request`, { method: "POST", body: JSON.stringify({ accept_sharing: true, name: profile?.name, class: profile?.class, taluka: profile?.taluka }) });
    const j = await r.json();
    if (!r.ok) { setError(typeof j.detail === "string" ? j.detail : t("mentor_error")); return; }
    setContacts((c) => ({ ...c, [id]: j.contact?.phone }));
    setAsking(null);
  };

  return (
    <Card>
      <h2 className="mb-2 font-bold">{t("mentors")} <Badge>{list.length}</Badge></h2>
      <div className="grid gap-2 text-sm">
        <label className="flex items-center gap-2">{t("within_km", { km: maxKm })}
          <input type="range" min={5} max={100} step={5} value={maxKm} onChange={(e) => setMaxKm(Number(e.target.value))} className="flex-1" />
        </label>
      </div>
      <RelatedNote picked={picked} />
      <ul className="mt-2 space-y-2">
        {list.map((m: any, i: number) => (
          <li key={m.id} className="rounded-xl bg-[var(--bg)] p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div><b>{m.name}</b>{i === 0 && list.length > 1 && m.score > 0 && <> <Badge tone="green">{t("mentor_best")}</Badge></>}<div className="text-xs text-[var(--muted)]">{m.works_as}</div></div>
              <span className="whitespace-nowrap text-xs text-[var(--muted)]">{placeLabel(t, m.taluka)}{m.km !== null ? ` · ~${Math.round(m.km)} ${t("distance_unit")}` : ""}</span>
            </div>
            {m.reasons.length > 0 && <div className="mt-1 text-xs font-semibold text-[var(--brand-ink)]">{t("mentor_why", { reasons: m.reasons.join(" · ") })}</div>}
            <div className="mt-1">{m.helps_with}</div>
            <div className="text-xs text-[var(--muted)]">{m.languages.map((x: string) => t(`langname_${x}`) === `langname_${x}` ? x : t(`langname_${x}`)).join(", ")} · {m.mode} · {m.available}</div>
            {m.note && <div className="mt-1"><Badge tone="amber">{m.note}</Badge></div>}
            {contacts[m.id] ? (
              <a href={`tel:${contacts[m.id].replace(/\s/g, "")}`} className="mt-2 block rounded-lg bg-[var(--good,#138808)] py-2 text-center font-semibold text-white">{contacts[m.id]}</a>
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
                {online ? `${t("request_mentor")}` : t("needs_internet")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{error}</p>}
    </Card>
  );
}
