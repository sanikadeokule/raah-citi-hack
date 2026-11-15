"use client";
// Recommendations a teacher sent to this student. Cached on the phone so they still show offline.
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, docLabel } from "./ui";
import { getKV, setKV } from "@/lib/db";
import { useApp } from "@/lib/store";

export function TeacherInbox() {
  const { auth, authFetch, t, online } = useApp();
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (auth?.user.role !== "student") return;
    getKV<any[]>("notifications").then((c) => c && setItems(c));
    if (!online) return;
    authFetch("/api/auth/notifications").then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (Array.isArray(j)) { setItems(j); setKV("notifications", j); }
    }).catch(() => {});
  }, [auth, authFetch, online]);

  const markRead = async (id: number) => {
    const next = items.map((n) => (n.id === id ? { ...n, read: true } : n));
    setItems(next);
    await setKV("notifications", next);
    authFetch(`/api/auth/notifications/${id}/read`, { method: "POST" }).catch(() => {});
  };

  const unread = items.filter((n) => !n.read && n.kind === "scheme_recommendation");
  if (!unread.length) return null;
  return (
    <div className="space-y-2">
      {unread.map((n) => (
        <Card key={n.id} className="border-l-4 border-[var(--accent)]">
          <div className="text-xs text-[var(--muted)]">📣 {n.from || t("your_teacher")} · {new Date(n.created_at * 1000).toLocaleDateString()}</div>
          <div className="mt-1 font-semibold">{t("teacher_recommends", { scheme: n.scheme_name })}</div>
          {n.plan_label && <div className="text-xs text-[var(--muted)]">{t("plan_for")}: {n.plan_label}</div>}
          {n.missing_docs?.length > 0 && (
            <div className="mt-1 text-sm">📄 {t("missing_document")}: {n.missing_docs.map((m: any) => docLabel(m.doc)).join(", ")}</div>
          )}
          <div className="mt-2 flex gap-2">
            <Link href={`/eligibility/?scheme=${n.scheme_id}${n.plan_id ? `&plan=${n.plan_id}` : ""}`} onClick={() => markRead(n.id)}
              className="flex-1 rounded-lg bg-[var(--brand)] py-2 text-center text-sm font-semibold text-white">{t("check")} ›</Link>
            <button onClick={() => markRead(n.id)} className="rounded-lg bg-[var(--bg)] px-3 py-2 text-sm">{t("got_it")}</button>
          </div>
        </Card>
      ))}
    </div>
  );
}
