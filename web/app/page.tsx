"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { categoryLabel } from "@/lib/labels";
import { useEffect, useState } from "react";
import { Card, Shell } from "@/components/ui";
import { Icon } from "@/components/icon";
import { todaysStep, type Step } from "@/lib/todaysstep";
import { myCareer } from "@/lib/tailor";
import { TeacherInbox } from "@/components/inbox";
import { ProShelf } from "@/components/pro";
import { getKV, setKV } from "@/lib/db";
import { useApp } from "@/lib/store";
import { placeLabel } from "@/lib/questions";
import { BUILD_ROADMAP_HREF } from "@/lib/roadmap";

// icon values are names from components/icon.tsx
const TILES = [
  { href: "/discover/", icon: "chat", key: "home_discover" },
  { href: "/careers/", icon: "compass", key: "home_careers" },
  { href: "/colleges/", icon: "graduation", key: "home_colleges" },
  { href: "/learn/", icon: "book", key: "home_learn" },
  { href: "/opportunity/", icon: "briefcase", key: "home_opportunity" },
  { href: "/eligibility/", icon: "clipboard", key: "home_eligibility" },
  { href: "/compare/", icon: "scales", key: "home_compare" },
  { href: "/notifications/", icon: "bell", key: "home_notifications" },
];
// the student home has six tiles; alerts live in the top bar, progress/roadmap/mentor in the profile menu
const STUDENT_TILES = [
  { href: "/careers/", icon: "compass", key: "home_careers" },
  { href: "/colleges/", icon: "graduation", key: "home_colleges" },
  { href: "/eligibility/", icon: "rupee", key: "home_eligibility" },
  { href: "/exams/", icon: "clipboard", key: "home_exams" },
  { href: "/learn/", icon: "book", key: "home_learn" },
  { href: "/opportunity/", icon: "briefcase", key: "home_opportunity" },
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
    <Link href="/teacher/" className="block rounded-2xl border-b-4 border-[var(--accent)] bg-[var(--brand)] px-4 py-3.5 text-white shadow-sm active:scale-[.98]">
      <span className="flex items-center gap-3">
        <Icon name="users" size={32} />
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-bold leading-tight">{t("tab_class")}</span>
          <span className="block text-xs leading-snug text-white/85">{t("home_class_dash_sub")}</span>
        </span>
        <span aria-hidden className="text-2xl">›</span>
      </span>
      {cls && (
        <span className="mt-3 grid grid-cols-3 gap-2 text-center">
          {stats.map((s) => (
            <span key={s.label} className="rounded-xl bg-white/10 px-1 py-2">
              <span className={`block text-xl font-bold ${s.tone}`}>{s.value}</span>
              <span className="block truncate text-[11px] text-white/80">{s.label}</span>
            </span>
          ))}
        </span>
      )}
    </Link>
  );
}

export default function Home() {
  const { t, profile, setProfile, data, auth, authFetch, lang } = useApp();
  const [tTab, setTTab] = useState<"class" | "tools">("class");
  const isTeacher = auth?.user.role === "teacher";
  // greet the signed-in person by their registered name, never by a demo profile
  const greetName = auth?.user.name || (isTeacher ? null : profile?.name) || "";
  // Today's step is decided by the agent from the student's tools; the plain rule shows until it answers or when offline
  const [agentStep, setAgentStep] = useState<(Step & { looked?: { label: string }[] }) | null>(null);
  useEffect(() => {
    if (!auth || isTeacher) return;
    authFetch("/api/agent/today", { method: "POST" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.key) setAgentStep(j); }).catch(() => {});
  }, [auth, isTeacher, authFetch, profile?.roadmap_career, profile?.ikigai?.confirmed_at]);
  const careerName = (id?: string) => data?.careers?.find((c: any) => c.id === id)?.name ?? id ?? "";
  const step = agentStep ? { ...agentStep, vars: { ...agentStep.vars, ...(agentStep.vars?.career ? { career: careerName(agentStep.vars.career) } : {}) } } : todaysStep(data, profile);
  const mine = myCareer(data, profile);
  const details = profile ? [profile.class && t("class_n", { n: profile.class }), placeLabel(t, profile.taluka), categoryLabel(profile.category, lang)].filter(Boolean).join(" · ") : "";
  return (
    <Shell back={null} fit>
      {/* language is switched from the header; the home screen fits one phone screen without scrolling */}
      {auth && (
        <Card className="space-y-2 !p-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-xl"><Icon name="user" size={22} /></div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold">{t("hello")}{greetName ? `, ${greetName}` : ""}</div>
              {!isTeacher && (details
                ? <div className="truncate text-xs text-[var(--muted)]">{details}</div>
                : <Link href="/profile/" className="text-xs font-semibold text-[var(--brand)] underline">{t("my_details")}</Link>)}
            </div>
          </div>

        </Card>
      )}
      <p className="-mt-1 px-1 text-xs leading-snug text-[var(--muted)]">{t("tagline")}</p>

      {isTeacher ? (
        <>
        <ClassDashboardCard />
        {/* two big tiles below the class card */}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setTTab(tTab === "tools" ? "class" : "tools")} aria-pressed={tTab === "tools"}
            className={`flex flex-col items-center justify-center rounded-2xl border-b-4 border-[var(--accent)] px-1 py-5 text-center shadow-sm active:scale-95 ${tTab === "tools" ? "bg-[var(--brand)] text-white" : "bg-[var(--card)] text-[var(--brand-ink)]"}`}>
            <Icon name="graduation" size={36} />
            <span className="mt-2 text-sm font-semibold leading-tight">{t("tab_student")}</span>
          </button>
          <Link href="/money/" className="flex flex-col items-center justify-center rounded-2xl border-b-4 border-[var(--accent)] bg-[var(--card)] px-1 py-5 text-center text-[var(--brand-ink)] shadow-sm active:scale-95">
            <Icon name="bank" size={36} />
            <span className="mt-2 text-sm font-semibold leading-tight">{t("home_money")}</span>
          </Link>
        </div>
        {tTab === "tools" && <>
        {profile && data?.students?.length > 0 && (
          <div className="rounded-xl bg-[var(--card)] p-3 ring-1 ring-black/5">
            <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
              {t("preview_demo")}
              <select aria-label={t("preview_demo")} value={profile.id ?? ""} onChange={(e) => setProfile(data.students.find((s: any) => s.id === e.target.value))}
                className="flex-1 rounded bg-[var(--bg)] px-2 py-1 text-sm">
                {data.students.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          {[{ href: "/ask/", icon: "chat", key: "home_ask" }, ...TILES, { href: "/exams/", icon: "clipboard", key: "home_exams" }].map((x) => (
            <Link key={x.href} href={x.href} className="flex flex-col items-center rounded-xl bg-[var(--card)] px-1 py-2.5 text-center text-xs leading-tight ring-1 ring-black/5 active:scale-95">
              <Icon name={x.icon} size={24} className="mb-1" />{t(x.key)}
            </Link>
          ))}
        </div>
        <ProShelf />
        </>}
        </>
      ) : (
        <>
        <TeacherInbox />

        {/* one step chosen for the student today, with the reason and the source */}
        <section aria-labelledby="step-h" className="rounded-2xl border-2 border-[var(--brand)] bg-[var(--card)] p-4 shadow-sm">
          <h2 id="step-h" className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">{t("step_title")}</h2>
          <p className="mt-1 text-base font-bold leading-snug">{t(step.key, step.vars)}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{t(`${step.key}_why`, step.vars)}</p>
          {step.source && <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{t("source")}: <a href={step.source.split(" ; ")[0]} target="_blank" rel="noreferrer" className="underline">{step.source.split(" ; ")[0].replace(/^https?:\/\/(www\.)?/, "")}</a></p>}
          {agentStep?.looked?.length ? <p className="mt-1 text-[11px] text-[var(--muted)]">{t("step_looked", { tools: agentStep.looked.map((x) => x.label).join(", ") })}</p> : null}
          <div className="mt-3 flex items-center gap-3">
            <Link href={step.href} className="inline-block rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-bold text-white active:scale-95">{t("step_do_it")}</Link>
            <Link href="/activity/" className="text-sm font-semibold text-[var(--brand-ink)] underline">{t("act_title")}</Link>
          </div>
        </section>

        {mine && (
          <div className="flex items-center gap-2 rounded-xl bg-[var(--brand-soft)] px-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1">{t("your_career")}: <b>{mine.career.name}</b>{!mine.saved && <span className="block text-[11px] text-[var(--muted)]">{t("best_match_note")}</span>}</span>
            <Link href={BUILD_ROADMAP_HREF} className="shrink-0 text-sm font-semibold text-[var(--brand-ink)] underline">{t("change")}</Link>
          </div>
        )}

        {/* tiles grow to fill the free height on tall screens and shrink (never below a big tap target) on short ones */}
        <div className="grid max-h-[30rem] min-h-[14rem] flex-1 grid-cols-3 gap-2">
          {STUDENT_TILES.map((x) => (
            <Link key={x.href} href={x.href} className="flex flex-col items-center justify-center rounded-2xl bg-[var(--card)] px-1 py-2 text-center text-[var(--brand-ink)] shadow-sm ring-1 ring-black/10 active:scale-95">
              <Icon name={x.icon} size={36} className="text-[var(--brand)]" />
              <span className="mt-2 font-semibold leading-tight text-sm">{t(x.key)}</span>
            </Link>
          ))}
        </div>

        <ProShelf />

        <Link href="/ask/" className="flex items-center gap-3 rounded-2xl bg-[var(--brand)] px-4 py-3 text-white shadow-sm active:scale-95">
          <Icon name="chat" size={28} />
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold">{t("home_ask")}</span>
            <span className="block truncate text-xs text-white/80">{t("ask_ex1")}</span>
          </span>
          <Icon name="mic" size={20} />
        </Link>

        </>
      )}
    </Shell>
  );
}
