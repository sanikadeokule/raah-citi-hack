"use client";
// Three tabs: For you (alerts sent to this student: notices from official sites that match their roadmap or
// scholarships, plus teacher/mentor messages, payouts ...), Deadlines (official notices with a last date ahead)
// and All updates (every notice Raah read from the official sites).
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fromNotification, NoticeCard, SourcesFooter, useNotices } from "@/components/notices";
import { Pager, usePaged } from "@/components/pager";
import { Tabs } from "@/components/tabs";
import { Card, Shell, SpeakButton } from "@/components/ui";
import { Icon } from "@/components/icon";
import { getKV, setKV } from "@/lib/db";
import { useApp } from "@/lib/store";

const KIND_META: Record<string, { icon: string; color: string }> = {
  scheme_recommendation: { icon: "bell", color: "bg-blue-50 border-blue-300 dark:bg-blue-900/20 dark:border-blue-700" },
  enrollment_confirmed:  { icon: "check", color: "bg-green-50 border-green-300 dark:bg-green-900/20 dark:border-green-700" },
  exam_update:           { icon: "calendar", color: "bg-red-50 border-red-300 dark:bg-red-900/20 dark:border-red-700" },
  payout:                { icon: "rupee", color: "bg-yellow-50 border-yellow-300 dark:bg-yellow-900/20 dark:border-yellow-700" },
  mentor_message:        { icon: "chat", color: "bg-purple-50 border-purple-300 dark:bg-purple-900/20 dark:border-purple-700" },
  deadline_alert:        { icon: "calendar", color: "bg-amber-50 border-amber-300 dark:bg-amber-900/20 dark:border-amber-700" },
  teacher_message:       { icon: "users", color: "bg-orange-50 border-orange-300 dark:bg-orange-900/20 dark:border-orange-700" },
};

function notifLink(n: any): string {
  if (n.kind === "scheme_recommendation") return `/eligibility/${n.scheme_id ? `?scheme=${n.scheme_id}` : ""}`;
  if (n.kind === "exam_update") return "/exams/";
  if (n.kind === "enrollment_confirmed") return "/learn/";
  if (n.kind === "payout") return "/money/";
  if (n.kind === "deadline_alert") return n.source === "tracker" ? "/tracker/" : (n.url || "/notifications/");
  if (n.kind === "mentor_message" || n.kind === "teacher_message") return "/ask/";
  return "#";
}

function notifTitle(n: any, t: (k: string, p?: any) => string): string {
  if (n.kind === "scheme_recommendation") return t("notif_scheme_rec", { scheme: n.scheme_name || t("notif_a_scheme") });
  if (n.kind === "exam_update") return t("notif_exam_update", { exam: n.exam_name || t("notif_an_exam") });
  if (n.kind === "enrollment_confirmed") return t("notif_enrolled", { module: n.module_title || t("notif_a_module") });
  if (n.kind === "payout") return t("notif_payout", { amount: n.amount ? `₹${n.amount}` : "" });
  if (n.kind === "mentor_message" || n.kind === "teacher_message") return t("notif_message", { from: n.from || t("notif_your_teacher") });
  return n.title || n.kind;
}

function NotifCard({ n, onRead, t }: { n: any; onRead: (id: number) => void; t: (k: string, p?: any) => string }) {
  const meta = KIND_META[n.kind] ?? { icon: "bell", color: "bg-(--bg) border-(--muted)" };
  const date = new Date(n.created_at * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const href = notifLink(n);
  const title = notifTitle(n, t);

  return (
    <li className={`flex items-start rounded-2xl border-l-4 overflow-hidden shadow-sm ${meta.color} ${n.read ? "opacity-60" : ""}`}>
      <Link
        href={href}
        onClick={() => !n.read && onRead(n.id)}
        className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4"
      >
        <Icon name={meta.icon} size={24} className="mt-0.5 text-(--brand)" />
        <div className="min-w-0 flex-1">
          <p className={`text-sm leading-snug ${n.read ? "" : "font-semibold"}`}>{title}</p>
          {n.body && <p className="mt-0.5 text-xs text-(--muted) line-clamp-2">{n.body}</p>}
          <div className="mt-1 flex items-center gap-2">
            {n.from && <span className="text-[11px] text-(--muted)">{n.from}</span>}
            <span className="text-[11px] text-(--muted)">{date}</span>
          </div>
        </div>
        {!n.read && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-(--brand)" aria-label={t("notif_unread")} />}
      </Link>
      {/* outside the link, so reading it aloud does not open it */}
      <div className="shrink-0 py-2 pr-2"><SpeakButton text={n.body ? `${title}. ${n.body}` : title} label="" /></div>
    </li>
  );
}

type Tab = "for_you" | "deadlines" | "all";

export default function NotificationsPage() {
  const { t, auth, authFetch, online } = useApp();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTabState] = useState<Tab>("for_you");
  useEffect(() => {
    try { const v = sessionStorage.getItem("notif_tab"); if (v === "deadlines" || v === "all") setTabState(v); } catch {}
  }, []);
  const setTab = (v: Tab) => { setTabState(v); try { sessionStorage.setItem("notif_tab", v); } catch {} };

  // matched notices (with checked translations and teacher verification) to enrich the "notice" alerts
  const mine = useNotices("for_you", true);
  const deadlines = useNotices("deadlines", tab === "deadlines");
  const all = useNotices("all", tab === "all");

  useEffect(() => {
    if (!auth) return;
    getKV<any[]>("notifications_all").then((c) => c && setItems(c));
    if (!online) return;
    setLoading(true);
    authFetch("/api/auth/notifications")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (Array.isArray(j)) { setItems(j); setKV("notifications_all", j); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [auth, authFetch, online]);

  const markRead = (id: number) => {
    const next = items.map((n) => (n.id === id ? { ...n, read: true } : n));
    setItems(next);
    setKV("notifications_all", next);
    authFetch(`/api/auth/notifications/${id}/read`, { method: "POST" }).catch(() => {});
  };

  const unread = items.filter((n) => !n.read);
  const read = items.filter((n) => n.read);

  const markAllRead = () => {
    unread.forEach((n) => markRead(n.id));
  };

  const byNotice = new Map(mine.items.map((x: any) => [x.id, x]));
  const renderItem = (n: any) => n.kind === "notice"
    ? <NoticeCard key={n.id} n={{ ...fromNotification(n), ...(byNotice.get(n.notice_id) ?? {}) }} unread={!n.read}
        onOpen={() => !n.read && markRead(n.id)} />
    : <NotifCard key={n.id} n={n} onRead={markRead} t={t} />;

  if (!auth) {
    return (
      <Shell title={t("notif_title")}>
        <Card className="text-center py-8">
          <Icon name="bell" size={40} className="mb-2 text-(--muted)" />
          <p className="text-sm text-(--muted)">{t("notif_login")}</p>
        </Card>
      </Shell>
    );
  }

  const list = tab === "deadlines" ? deadlines : all;
  return (
    <NotificationsView {...{ tab, setTab, unread, read, items, loading, markAllRead, renderItem, mine, list }} />
  );
}

const PAGE = 5;

function NotificationsView({ tab, setTab, unread, read, items, loading, markAllRead, renderItem, mine, list }: {
  tab: Tab; setTab: (v: Tab) => void; unread: any[]; read: any[]; items: any[]; loading: boolean; markAllRead: () => void;
  renderItem: (n: any) => React.ReactNode; mine: ReturnType<typeof useNotices>; list: ReturnType<typeof useNotices>;
}) {
  const { t } = useApp();
  const pg = usePaged(list.items, PAGE, tab);
  const mineAll = useMemo(() => [...unread, ...read], [unread, read]);
  const pgMine = usePaged(mineAll, PAGE, `${tab}|${items.length}`);
  const pageUnread = pgMine.pageItems.filter((n: any) => !n.read);
  const pageRead = pgMine.pageItems.filter((n: any) => n.read);
  return (
    <Shell title={t("notif_title")}>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: "for_you", label: t("notices_tab_for_you"), count: unread.length || undefined },
        { key: "deadlines", label: t("notices_tab_deadlines") },
        { key: "all", label: t("notices_tab_all") },
      ]} />

      {tab === "for_you" && (<>
        {loading && items.length === 0 && (
          <p className="text-sm text-(--muted) animate-pulse px-1">{t("loading")}</p>
        )}

        {!loading && items.length === 0 && (
          <Card className="text-center py-10 space-y-2">
            <Icon name="bell" size={40} className="text-(--muted)" />
            <p className="text-sm text-(--muted)">{t("notices_empty_for_you")}</p>
          </Card>
        )}

        <div ref={pgMine.top} />
        {pageUnread.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <p className="text-xs font-semibold text-(--muted) uppercase tracking-wide">
                {t("notif_new")} · {unread.length}
              </p>
              <button onClick={markAllRead} className="text-xs font-semibold text-(--brand)">
                {t("notif_mark_all_read")}
              </button>
            </div>
            <ul className="space-y-2">{pageUnread.map(renderItem)}</ul>
          </div>
        )}

        {pageRead.length > 0 && (
          <div className="space-y-2">
            <p className="px-1 text-xs font-semibold text-(--muted) uppercase tracking-wide">{t("notif_earlier")}</p>
            <ul className="space-y-2">{pageRead.map(renderItem)}</ul>
          </div>
        )}
        <Pager {...pgMine} shown={pgMine.pageItems.length} />
        <SourcesFooter sources={mine.sources} lastChecked={mine.last_checked} />
      </>)}

      {tab !== "for_you" && (<>
        {!list.loaded && <p className="text-sm text-(--muted) animate-pulse px-1">{t("loading")}</p>}
        {list.loaded && list.items.length === 0 && (
          <Card className="text-center py-10 space-y-2">
            <Icon name={tab === "deadlines" ? "calendar" : "doc"} size={40} className="text-(--muted)" />
            <p className="text-sm text-(--muted)">{t(tab === "deadlines" ? "notices_empty_deadlines" : "notices_empty_all")}</p>
          </Card>
        )}
        <div ref={pg.top} />
        {list.items.length > 0 && <ul className="space-y-2">{pg.pageItems.map((n: any) => <NoticeCard key={n.id} n={n} />)}</ul>}
        <Pager {...pg} shown={pg.pageItems.length} />
        <SourcesFooter sources={list.sources} lastChecked={list.last_checked} />
      </>)}
    </Shell>
  );
}
