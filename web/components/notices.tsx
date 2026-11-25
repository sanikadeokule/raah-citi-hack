"use client";
// Notices read from official sites (NTA, JEE Main, NEET, CET Cell, MahaDBT) by the backend's notice watcher.
// NoticeCard shows one: source, title (in the student's language when a checked translation exists, with the
// original underneath), deadline chip, "why you see this", and Open / Listen / Send to parent.
// TeacherNotices is the teacher's panel: "Check official sites now" with live steps, then Verify / Hide.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Icon } from "@/components/icon";
import { useCallback, useEffect, useState } from "react";
import { Card, SpeakButton } from "@/components/ui";
import { getKV, setKV } from "@/lib/db";
import { useApp } from "@/lib/store";

type T = (k: string, vars?: Record<string, string | number>) => string;

const CAT_ICON: Record<string, string> = {
  result: "flag", admit_card: "doc", application: "pencil", admission: "school", exam: "calendar", scholarship: "rupee", general: "bell",
};

/** Whole days from today to an ISO date (negative when past). */
export function daysLeft(iso?: string | null): number | null {
  if (!iso || iso.length !== 10) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86400000);
}

export function fmtDate(iso?: string | null, lang = "en"): string {
  if (!iso) return "";
  const parts = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(parts[0], (parts[1] || 1) - 1, parts[2] || 1));
  const loc = lang === "en" ? "en-IN" : `${lang}-IN`;
  return dt.toLocaleDateString(loc, parts.length === 3 ? { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }
    : { month: "short", year: "numeric", timeZone: "UTC" });
}

function DeadlineChip({ deadline, t, lang }: { deadline?: string | null; t: T; lang: string }) {
  const n = daysLeft(deadline);
  if (n === null || n < 0) return null;
  const urgent = n < 7;
  const label = n === 0 ? t("notice_closes_today") : n === 1 ? t("notice_closes_tomorrow")
    : n <= 30 ? t("notice_closes_in", { n }) : t("notice_last_date", { date: fmtDate(deadline, lang) });
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${urgent
      ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" : "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"}`}>
       {label}
    </span>
  );
}

export function whyText(why: string | undefined, ref: string | undefined, t: T): string | null {
  if (!why || !ref) return null;
  const k = `notice_why_${why}`;
  const v = t(k, { name: ref });
  return v === k ? null : v;
}

/** A notification of kind "notice" carries the same fields as a notice from /api/notices. */
export function fromNotification(n: any): any {
  return { id: n.notice_id, title: n.title, url: n.url, source_short: n.source, category: n.category,
    published: n.published, deadline: n.deadline, why: n.why, why_ref: n.why_ref, created_at: n.created_at };
}

export function NoticeCard({ n, unread, onOpen }: { n: any; unread?: boolean; onOpen?: () => void }) {
  const { t, lang } = useApp();
  const translated = n.summary?.[lang];
  const showTranslation = translated && translated !== n.title;
  const title = showTranslation ? translated : n.title;
  const why = whyText(n.why, n.why_ref, t);
  const cat = n.category || "general";
  const catLabel = t(`notice_cat_${cat}`);
  const wa = [t("notice_wa_intro", { source: n.source_name || n.source_short || "" }), n.title,
    n.deadline ? t("notice_last_date", { date: fmtDate(n.deadline, lang) }) : "",
    t("notice_wa_link", { url: n.url }), `— ${t("notice_wa_footer")}`].filter(Boolean).join("\n");
  const speak = [title, n.deadline ? t("notice_last_date", { date: fmtDate(n.deadline, lang) }) : "", why ?? ""].filter(Boolean).join(". ");

  return (
    <li className={`rounded-2xl bg-[var(--card)] p-3 shadow-sm ring-1 ring-black/5 ${unread ? "border-l-4 border-[var(--brand)]" : ""}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-md bg-[var(--header-bg)] px-1.5 py-0.5 font-bold text-white">{n.source_short}</span>
        <span className="text-[var(--muted)]"><Icon name={CAT_ICON[cat] ?? "bell"} size={14} className="mr-1 align-[-2px]" />{catLabel === `notice_cat_${cat}` ? cat : catLabel}</span>
        {n.published && <span className="text-[var(--muted)]">· {t("notice_published", { date: fmtDate(n.published, lang) })}</span>}
        {unread && <span className="ml-auto h-2.5 w-2.5 rounded-full bg-[var(--brand)]" aria-label="unread" />}
      </div>

      <p className={`mt-1.5 text-sm leading-snug ${unread ? "font-semibold" : "font-medium"}`}>{title}</p>
      {showTranslation && <p className="mt-0.5 text-xs text-[var(--muted)]">{t("notice_original")}: {n.title}</p>}

      {(n.deadline || why) && (
        <div className="mt-2 flex flex-col items-start gap-1">
          <DeadlineChip deadline={n.deadline} t={t} lang={lang} />
          {why && <p className="text-xs text-[var(--brand-ink)]">{why}</p>}
        </div>
      )}

      <p className="mt-2 text-[11px] text-[var(--muted)]">
        {n.verified ? `${t("notice_verified")}` : `${t("notice_unverified")}`}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <a href={n.url} target="_blank" rel="noreferrer" onClick={onOpen}
          className="rounded-full bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-white"> {t("notice_open")}</a>
        <SpeakButton text={speak} label="" />
        <a href={`https://wa.me/?text=${encodeURIComponent(wa)}`} target="_blank" rel="noreferrer"
          className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"> {t("notice_send_parent")}</a>
      </div>
    </li>
  );
}

/** "Last checked 10:40 · 5 official sites", plus a line for any site that was down. */
export function SourcesFooter({ sources, lastChecked }: { sources: any[]; lastChecked: number | null }) {
  const { t, lang } = useApp();
  if (!sources?.length) return null;
  if (!lastChecked) return <p className="px-1 text-center text-xs text-[var(--muted)]">{t("notices_never")}</p>;
  const loc = lang === "en" ? "en-IN" : `${lang}-IN`;
  const time = new Date(lastChecked * 1000).toLocaleString(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const stale = sources.filter((s) => s.status === "snapshot" || s.status === "error");
  return (
    <div className="space-y-1 px-1 text-center text-xs text-[var(--muted)]">
      <p>{t("notices_footer", { time, n: sources.length })}</p>
      {stale.map((s) => <p key={s.id}>{t("notices_snapshot", { site: s.short })}</p>)}
      <p className="flex flex-wrap justify-center gap-x-2">
        {sources.map((s) => <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="underline">{s.short}</a>)}
      </p>
    </div>
  );
}

/** Notices for one tab of /api/notices, cached on the phone so they show offline. */
export function useNotices(tab: "all" | "deadlines" | "for_you", enabled: boolean) {
  const { authFetch, online, auth } = useApp();
  const [state, setState] = useState<{ items: any[]; sources: any[]; last_checked: number | null; loaded: boolean }>(
    { items: [], sources: [], last_checked: null, loaded: false });
  useEffect(() => {
    if (!enabled || !auth) return;
    let gone = false;
    const key = `notices_${tab}`;
    getKV<any>(key).then((c) => { if (c && !gone) setState({ ...c, loaded: true }); });
    if (!online) { setState((s) => ({ ...s, loaded: true })); return; }
    authFetch(`/api/notices?tab=${tab}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!j || gone) return;
      const next = { items: j.items ?? [], sources: j.sources ?? [], last_checked: j.last_checked ?? null };
      setState({ ...next, loaded: true });
      setKV(key, next);
    }).catch(() => setState((s) => ({ ...s, loaded: true })));
    return () => { gone = true; };
  }, [tab, enabled, auth, online, authFetch]);
  return state;
}

// ------------------------------------------------------------------ teacher

type RunLine = { key: string; text: string; tone?: "ok" | "warn" | "done" };

export function TeacherNotices() {
  const { t, authFetch, showToast } = useApp();
  const [data, setData] = useState<{ items: any[]; sources: any[] } | null>(null);
  const [lines, setLines] = useState<RunLine[]>([]);
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    authFetch("/api/notices/teacher").then((r) => (r.ok ? r.json() : null)).then((j) => j && setData(j)).catch(() => {});
  }, [authFetch]);
  useEffect(() => { load(); }, [load]);

  const checkNow = async () => {
    setRunning(true);
    setLines([]);
    const add = (l: RunLine) => setLines((xs) => [...xs.filter((x) => x.key !== l.key), l]);
    try {
      const r = await authFetch("/api/notices/refresh", { method: "POST", headers: { Accept: "text/event-stream" } });
      if (!r.ok || !r.body) throw new Error(String(r.status));
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "source_start") add({ key: ev.source, text: t("notices_step_reading", { site: ev.name }) });
          else if (ev.type === "source_done") add({ key: ev.source, tone: ev.status === "ok" ? "ok" : "warn",
            text: ev.status === "ok" ? t("notices_step_done", { site: ev.name, found: ev.found, new: ev.new })
              : ev.status === "snapshot" ? `${t("notices_step_snapshot", { site: ev.name })} · ${t("notices_step_done", { site: ev.name, found: ev.found, new: ev.new })}`
              : t("notices_step_error", { site: ev.name }) });
          else if (ev.type === "matching") add({ key: "matching", text: t("notices_step_matching") });
          else if (ev.type === "translating") add({ key: "translating", text: t("notices_step_translating") });
          else if (ev.type === "done") add({ key: "done", tone: "done", text: t("notices_run_done", { fresh: ev.fresh, sent: ev.sent, students: ev.students }) });
          else if (ev.type === "busy") showToast(t("notices_busy"));
          else if (ev.type === "error") add({ key: "error", tone: "warn", text: ev.error });
        }
      }
    } catch {
      showToast(t("ask_offline"));
    }
    setRunning(false);
    load();
  };

  const act = async (id: number, what: "verify" | "hide" | "unhide") => {
    const r = await authFetch(`/api/notices/${id}/${what}`, { method: "POST" });
    if (r.ok) load();
  };

  return (
    <>
      <Card className="space-y-2">
        <h2 className="font-bold">{t("teacher_tab_notices")}</h2>
        <p className="text-xs text-[var(--muted)]">{t("notices_teacher_intro")}</p>
        <button onClick={checkNow} disabled={running}
          className="w-full rounded-xl bg-[var(--accent)] py-3 font-semibold text-white disabled:opacity-60">
          {running ? `${t("notices_checking")}` : `${t("notices_check_now")}`}
        </button>
        {lines.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-[var(--bg)] p-2 text-xs" aria-live="polite">
            {lines.map((l) => (
              <li key={l.key} className={l.tone === "done" ? "font-semibold text-[var(--good)]" : l.tone === "warn" ? "text-[var(--bad)]" : ""}>
                {l.tone === "ok" ? "✓" : l.tone === "warn" ? "⚠" : l.tone === "done" ? "✓" : "…"} {l.text}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data && data.items.length === 0 && <Card className="text-center text-sm text-[var(--muted)]">{t("notices_teacher_empty")}</Card>}
      {data && data.items.length > 0 && (
        <ul className="space-y-2">
          {data.items.map((n: any) => (
            <li key={n.id} className={`rounded-2xl bg-[var(--card)] p-3 text-sm shadow-sm ring-1 ring-black/5 ${n.hidden ? "opacity-50" : ""}`}>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="rounded-md bg-[var(--header-bg)] px-1.5 py-0.5 font-bold text-white">{n.source_short}</span>
                {n.published && <span className="text-[var(--muted)]">{fmtDate(n.published)}</span>}
                {n.verified && <span className="text-[var(--good)]">{t("notice_verified")}</span>}
                {n.hidden && <span className="text-[var(--muted)]">· {t("notices_hidden")}</span>}
              </div>
              <a href={n.url} target="_blank" rel="noreferrer" className="mt-1 block font-medium leading-snug underline-offset-2 hover:underline">{n.title}</a>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                <span>{t("notices_students", { n: n.students })}</span>
                {n.exams.length > 0 && <span>· {n.exams.map((e: any) => e.name).join(", ")}</span>}
                {n.deadline && <span>·  {fmtDate(n.deadline)}</span>}
              </div>
              <div className="mt-2 flex gap-2">
                {!n.verified && <button onClick={() => act(n.id, "verify")} className="rounded-full bg-[var(--brand)] px-3 py-1 text-xs font-semibold text-white">✓ {t("notices_verify")}</button>}
                <button onClick={() => act(n.id, n.hidden ? "unhide" : "hide")} className="rounded-full bg-[var(--bg)] px-3 py-1 text-xs font-semibold">
                  {n.hidden ? t("notices_unhide") : t("notices_hide")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && <SourcesFooter sources={data.sources} lastChecked={Math.max(0, ...data.sources.map((s: any) => s.last_checked || 0)) || null} />}
    </>
  );
}
