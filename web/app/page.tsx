"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, Shell } from "@/components/ui";
import { TeacherInbox } from "@/components/inbox";
import { HomeStory } from "@/components/story";
import { ProShelf } from "@/components/pro";
import { getKV, setKV } from "@/lib/db";
import { useApp } from "@/lib/store";
import { BUILD_ROADMAP_HREF, hasRoadmap } from "@/lib/roadmap";

const TILES = [
  { href: "/discover/", icon: "🗣️", key: "home_discover" },
  { href: "/careers/", icon: "🧭", key: "home_careers" },
  { href: "/colleges/", icon: "🎓", key: "home_colleges" },
  { href: "/learn/", icon: "🎧", key: "home_learn" },
  { href: "/opportunity/", icon: "🛠️", key: "home_opportunity" },
  { href: "/eligibility/", icon: "📋", key: "home_eligibility" },
  { href: "/compare/", icon: "⚖️", key: "home_compare" },
  { href: "/notifications/", icon: "🔔", key: "home_notifications" },
];
const STUDENT_TILES = [...TILES, { href: "/progress/", icon: "📈", key: "home_progress" }];
const STAFF = [
  { href: "/exams/", icon: "📝", key: "home_exams" },
  { href: "/teacher/", icon: "👩‍🏫", key: "home_teacher" },
  { href: "/money/", icon: "🏦", key: "home_money" },
];

// A teacher's main job is the class: one big card to the class dashboard with the headline numbers.
function ClassDashboardCard() {
  const { t, auth, authFetch, online, data } = useApp();
  const [cls, setCls] = useState<any>(null);
  useEffect(() => {
    if (auth?.user.role !== "teacher") return;
    // same cache key as the dashboard page, so the numbers show offline and match it
    getKV("teacher_class").then((c) => c && setCls(c));
    if (!online) return;
    authFetch("/api/teacher/class").then((r) => (r.ok ? r.json() : null)).then((c) => {
      if (c) { setCls(c); setKV("teacher_class", c); }
    }).catch(() => {});
  }, [auth, authFetch, online, data?.version?.modified]);
  const st: any[] = cls?.students ?? [];
  const stats = [
    { label: t("students"), value: st.length, tone: "text-white" },
    { label: t("risk"), value: st.filter((s) => s.risk_level === "high").length, tone: "text-red-200" },
    { label: t("talent"), value: st.filter((s) => s.talent).length, tone: "text-green-200" },
  ];
  return (
    <Link href="/teacher/" className="flex flex-1 flex-col justify-center rounded-3xl border-b-4 border-[var(--accent)] bg-[var(--brand)] px-5 py-5 text-white shadow-sm active:scale-95">
      <span className="flex items-center gap-3">
        <span className="text-4xl leading-none">👩‍🏫</span>
        <span className="min-w-0 flex-1">
          <span className="block text-xl font-bold leading-tight">{t("teacher_dashboard")}</span>
          <span className="block text-xs leading-snug text-white/85">{t("home_class_dash_sub")}</span>
        </span>
        <span aria-hidden className="text-2xl">›</span>
      </span>
      {cls && (
        <span className="mt-4 grid grid-cols-3 gap-2 text-center">
          {stats.map((s) => (
            <span key={s.label} className="rounded-xl bg-white/10 px-1 py-2">
              <span className={`block text-2xl font-bold ${s.tone}`}>{s.value}</span>
              <span className="block truncate text-[11px] text-white/80">{s.label}</span>
            </span>
          ))}
        </span>
      )}
    </Link>
  );
}

export default function Home() {
  const { t, profile, setProfile, data, auth } = useApp();
  const isTeacher = auth?.user.role === "teacher";
  // greet the signed-in person by their registered name, never by a demo profile
  const greetName = auth?.user.name || (isTeacher ? null : profile?.name) || "";
  const unlocked = hasRoadmap(profile, auth?.user.role);
  const details = profile ? [profile.class && `Class ${profile.class}`, profile.taluka, profile.category].filter(Boolean).join(" · ") : "";
  return (
    <Shell back={null} fit>
      {/* language is switched from the header; the home screen fits one phone screen without scrolling */}
      {auth && (
        <Card className="space-y-2 !p-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-xl">{isTeacher ? "👩‍🏫" : "🙂"}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold">{t("hello")}{greetName ? `, ${greetName}` : ""}</div>
              {!isTeacher && unlocked && (details
                ? <div className="truncate text-xs text-[var(--muted)]">{details}</div>
                : <Link href="/profile/" className="text-xs font-semibold text-[var(--brand)] underline">{t("my_details")}</Link>)}
            </div>
          </div>
          {isTeacher && profile && data?.students?.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
              {t("preview_demo")}
              <select aria-label={t("preview_demo")} value={profile.id ?? ""} onChange={(e) => setProfile(data.students.find((s: any) => s.id === e.target.value))}
                className="flex-1 rounded bg-[var(--bg)] px-2 py-1 text-sm">
                {data.students.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}
        </Card>
      )}
      <p className="-mt-1 px-1 text-xs leading-snug text-[var(--muted)]">{t("tagline")}</p>

      {isTeacher ? (
        <>
        <ClassDashboardCard />

        {/* the student screens stay one tap away, smaller, for previewing what a student sees */}
        <div className="space-y-1">
          <div className="px-1 text-xs font-semibold text-[var(--muted)]">{t("home_student_tools")}</div>
          <div className="grid grid-cols-3 gap-2">
            {[{ href: "/ask/", icon: "💬", key: "home_ask" }, ...TILES].map((x) => (
              <Link key={x.href} href={x.href} className="flex flex-col items-center rounded-xl bg-[var(--card)] px-1 py-2 text-center text-xs leading-tight text-[var(--brand-ink)] ring-1 ring-black/5 active:scale-95">
                <span className="text-2xl">{x.icon}</span>{t(x.key)}
              </Link>
            ))}
          </div>
        </div>

        <ProShelf />

        <div className="grid grid-cols-3 gap-2">
          {STAFF.filter((x) => x.href !== "/teacher/").map((x) => (
            <Link key={x.href} href={x.href} className="flex flex-col items-center rounded-xl bg-[var(--card)] px-1 py-2 text-center text-xs leading-tight ring-1 ring-black/5">
              <span className="text-xl">{x.icon}</span>{t(x.key)}
            </Link>
          ))}
        </div>
        </>
      ) : !unlocked ? (
        /* before a roadmap exists there is one thing to do: build it. A short story shows why. */
        <HomeStory href={BUILD_ROADMAP_HREF} />
      ) : (
        <>
        <TeacherInbox />

        <Link href="/ask/" className="flex items-center gap-3 rounded-2xl border-b-4 border-[var(--accent)] bg-[var(--brand)] px-4 py-3 text-white shadow-sm active:scale-95">
          <span className="text-3xl">💬</span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold">{t("home_ask")}</span>
            <span className="block truncate text-xs text-white/80">{t("ask_ex1")}</span>
          </span>
        </Link>

        {/* tiles grow to fill the free height on tall screens and shrink (never below a big tap target) on short ones */}
        <div className="grid max-h-[30rem] min-h-[14rem] flex-1 grid-cols-3 gap-2">
          {STUDENT_TILES.map((x) => (
            <Link key={x.href} href={x.href} className="flex flex-col items-center justify-center rounded-2xl border-b-4 border-[var(--accent)] bg-[var(--card)] px-1 py-2 text-center text-[var(--brand-ink)] shadow-sm ring-1 ring-black/5 active:scale-95">
              <span className="text-4xl leading-none">{x.icon}</span>
              <span className="mt-2 font-semibold leading-tight text-sm">{t(x.key)}</span>
            </Link>
          ))}
        </div>

        <ProShelf />

        <div className="grid grid-cols-4 gap-2">
          {STAFF.map((x) => (
            <Link key={x.href} href={x.href} className="flex flex-col items-center rounded-xl bg-[var(--card)] px-1 py-2 text-center text-xs leading-tight ring-1 ring-black/5">
              <span className="text-xl">{x.icon}</span>{t(x.key)}
            </Link>
          ))}
        </div>
        </>
      )}
    </Shell>
  );
}
