"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { Card, Shell } from "@/components/ui";
import { TeacherInbox } from "@/components/inbox";
import { useApp } from "@/lib/store";

const TILES = [
  { href: "/discover/", icon: "🗣️", key: "home_discover" },
  { href: "/careers/", icon: "🧭", key: "home_careers" },
  { href: "/learn/", icon: "🎧", key: "home_learn" },
  { href: "/opportunity/", icon: "🛠️", key: "home_opportunity" },
  { href: "/eligibility/", icon: "🎓", key: "home_eligibility" },
  { href: "/compare/", icon: "⚖️", key: "home_compare" },
];
const STAFF = [
  { href: "/exams/", icon: "📝", key: "home_exams" },
  { href: "/teacher/", icon: "👩‍🏫", key: "home_teacher" },
  { href: "/money/", icon: "🏦", key: "home_money" },
  { href: "/data/", icon: "📊", key: "home_data" },
];

export default function Home() {
  const { t, profile, setProfile, data, auth } = useApp();
  const isTeacher = auth?.user.role === "teacher";
  // greet the signed-in person by their registered name, never by a demo profile
  const greetName = auth?.user.name || (isTeacher ? null : profile?.name) || "";
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
              {!isTeacher && (details
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

      <TeacherInbox />

      <Link href="/ask/" className="flex items-center gap-3 rounded-2xl border-b-4 border-[var(--accent)] bg-[var(--brand)] px-4 py-3 text-white shadow-sm active:scale-95">
        <span className="text-3xl">💬</span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold">{t("home_ask")}</span>
          <span className="block truncate text-xs text-white/80">{t("ask_ex1")}</span>
        </span>
      </Link>

      {/* tiles grow to fill the free height on tall screens and shrink (never below a big tap target) on short ones */}
      <div className="grid max-h-[24rem] min-h-[13rem] flex-1 grid-cols-3 grid-rows-2 gap-2">
        {TILES.map((x) => (
          <Link key={x.href} href={x.href} className="flex flex-col items-center justify-center rounded-2xl border-b-4 border-[var(--accent)] bg-[var(--card)] px-1 text-center text-[var(--brand-ink)] shadow-sm ring-1 ring-black/5 active:scale-95">
            <span className="text-4xl leading-none">{x.icon}</span>
            <span className="mt-2 text-sm font-semibold leading-tight">{t(x.key)}</span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-2">
        {STAFF.map((x) => (
          <Link key={x.href} href={x.href} className="flex flex-col items-center rounded-xl bg-[var(--card)] px-1 py-2 text-center text-xs leading-tight ring-1 ring-black/5">
            <span className="text-xl">{x.icon}</span>{t(x.key)}
          </Link>
        ))}
      </div>
      {data && (
        <p className="truncate text-center text-[11px] text-[var(--muted)]">
          {t("live_data")}: {data.version.file} · {new Date(data.version.modified).toLocaleString()}
        </p>
      )}
    </Shell>
  );
}
