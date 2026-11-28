/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared between the Notifications page and the Home alerts panel: how a notification is labelled and linked.

export const KIND_META: Record<string, { icon: string; color: string }> = {
  scheme_recommendation: { icon: "bell", color: "bg-blue-50 border-blue-300 dark:bg-blue-900/20 dark:border-blue-700" },
  enrollment_confirmed:  { icon: "check", color: "bg-green-50 border-green-300 dark:bg-green-900/20 dark:border-green-700" },
  exam_update:           { icon: "calendar", color: "bg-red-50 border-red-300 dark:bg-red-900/20 dark:border-red-700" },
  payout:                { icon: "rupee", color: "bg-yellow-50 border-yellow-300 dark:bg-yellow-900/20 dark:border-yellow-700" },
  mentor_message:        { icon: "chat", color: "bg-purple-50 border-purple-300 dark:bg-purple-900/20 dark:border-purple-700" },
  deadline_alert:        { icon: "calendar", color: "bg-amber-50 border-amber-300 dark:bg-amber-900/20 dark:border-amber-700" },
  teacher_message:       { icon: "users", color: "bg-orange-50 border-orange-300 dark:bg-orange-900/20 dark:border-orange-700" },
};

export function notifLink(n: any): string {
  if (n.kind === "scheme_recommendation") return `/eligibility/${n.scheme_id ? `?scheme=${n.scheme_id}` : ""}`;
  if (n.kind === "exam_update") return "/exams/";
  if (n.kind === "enrollment_confirmed") return "/learn/";
  if (n.kind === "payout") return "/money/";
  if (n.kind === "deadline_alert") return n.source === "tracker" ? "/tracker/" : (n.url || "/notifications/");
  if (n.kind === "mentor_message" || n.kind === "teacher_message") return "/ask/";
  return "#";
}

export function notifTitle(n: any, t: (k: string, p?: any) => string): string {
  if (n.kind === "scheme_recommendation") return t("notif_scheme_rec", { scheme: n.scheme_name || t("notif_a_scheme") });
  if (n.kind === "exam_update") return t("notif_exam_update", { exam: n.exam_name || t("notif_an_exam") });
  if (n.kind === "enrollment_confirmed") return t("notif_enrolled", { module: n.module_title || t("notif_a_module") });
  if (n.kind === "payout") return t("notif_payout", { amount: n.amount ? `₹${n.amount}` : "" });
  if (n.kind === "mentor_message" || n.kind === "teacher_message") return t("notif_message", { from: n.from || t("notif_your_teacher") });
  return n.title || n.kind;
}
