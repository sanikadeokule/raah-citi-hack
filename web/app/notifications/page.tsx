"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, Shell } from "@/components/ui";
import { getKV, setKV } from "@/lib/db";
import { useApp } from "@/lib/store";

const KIND_META: Record<string, { icon: string; color: string }> = {
  scheme_recommendation: { icon: "📣", color: "bg-blue-50 border-blue-300 dark:bg-blue-900/20 dark:border-blue-700" },
  enrollment_confirmed:  { icon: "✅", color: "bg-green-50 border-green-300 dark:bg-green-900/20 dark:border-green-700" },
  exam_update:           { icon: "📅", color: "bg-red-50 border-red-300 dark:bg-red-900/20 dark:border-red-700" },
  payout:                { icon: "💰", color: "bg-yellow-50 border-yellow-300 dark:bg-yellow-900/20 dark:border-yellow-700" },
  mentor_message:        { icon: "💬", color: "bg-purple-50 border-purple-300 dark:bg-purple-900/20 dark:border-purple-700" },
  teacher_message:       { icon: "👩‍🏫", color: "bg-orange-50 border-orange-300 dark:bg-orange-900/20 dark:border-orange-700" },
};

function notifLink(n: any): string {
  if (n.kind === "scheme_recommendation") return `/eligibility/${n.scheme_id ? `?scheme=${n.scheme_id}` : ""}`;
  if (n.kind === "exam_update") return "/exams/";
  if (n.kind === "enrollment_confirmed") return "/learn/";
  if (n.kind === "payout") return "/money/";
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
  const meta = KIND_META[n.kind] ?? { icon: "🔔", color: "bg-[var(--bg)] border-[var(--muted)]" };
  const date = new Date(n.created_at * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const href = notifLink(n);
  const title = notifTitle(n, t);

  return (
    <li className={`rounded-2xl border-l-4 overflow-hidden shadow-sm ${meta.color} ${n.read ? "opacity-60" : ""}`}>
      <Link
        href={href}
        onClick={() => !n.read && onRead(n.id)}
        className="flex items-start gap-3 px-4 py-3"
      >
        <span className="mt-0.5 text-2xl shrink-0">{meta.icon}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm leading-snug ${n.read ? "" : "font-semibold"}`}>{title}</p>
          {n.body && <p className="mt-0.5 text-xs text-[var(--muted)] line-clamp-2">{n.body}</p>}
          <div className="mt-1 flex items-center gap-2">
            {n.from && <span className="text-[11px] text-[var(--muted)]">{n.from}</span>}
            <span className="text-[11px] text-[var(--muted)]">{date}</span>
          </div>
        </div>
        {!n.read && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--brand)]" aria-label="unread" />}
      </Link>
    </li>
  );
}

export default function NotificationsPage() {
  const { t, auth, authFetch, online } = useApp();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

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

  if (!auth) {
    return (
      <Shell title={t("notif_title")}>
        <Card className="text-center py-8">
          <p className="text-4xl mb-2">🔔</p>
          <p className="text-sm text-[var(--muted)]">{t("notif_login")}</p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell title={t("notif_title")}>
      {loading && items.length === 0 && (
        <p className="text-sm text-[var(--muted)] animate-pulse px-1">{t("loading")}</p>
      )}

      {!loading && items.length === 0 && (
        <Card className="text-center py-10 space-y-2">
          <p className="text-4xl">🔔</p>
          <p className="text-sm text-[var(--muted)]">{t("notif_empty")}</p>
        </Card>
      )}

      {unread.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
              {t("notif_new")} · {unread.length}
            </p>
            <button onClick={markAllRead} className="text-xs font-semibold text-[var(--brand)]">
              {t("notif_mark_all_read")}
            </button>
          </div>
          <ul className="space-y-2">
            {unread.map((n) => <NotifCard key={n.id} n={n} onRead={markRead} t={t} />)}
          </ul>
        </div>
      )}

      {read.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">{t("notif_earlier")}</p>
          <ul className="space-y-2">
            {read.map((n) => <NotifCard key={n.id} n={n} onRead={markRead} t={t} />)}
          </ul>
        </div>
      )}
    </Shell>
  );
}
