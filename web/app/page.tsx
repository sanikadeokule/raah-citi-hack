"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { Card, Shell } from "@/components/ui";
import { LANGS, useApp } from "@/lib/store";

const TILES = [
  { href: "/discover/", icon: "🗣️", key: "home_discover", color: "bg-emerald-100" },
  { href: "/careers/", icon: "🧭", key: "home_careers", color: "bg-sky-100" },
  { href: "/learn/", icon: "🎧", key: "home_learn", color: "bg-violet-100" },
  { href: "/opportunity/", icon: "🛠️", key: "home_opportunity", color: "bg-amber-100" },
  { href: "/eligibility/", icon: "🎓", key: "home_eligibility", color: "bg-rose-100" },
  { href: "/compare/", icon: "⚖️", key: "home_compare", color: "bg-lime-100" },
];
const STAFF = [
  { href: "/teacher/", icon: "👩‍🏫", key: "home_teacher" },
  { href: "/money/", icon: "🏦", key: "home_money" },
  { href: "/data/", icon: "📊", key: "home_data" },
];

export default function Home() {
  const { t, lang, setLang, profile, setProfile, data } = useApp();
  return (
    <Shell back={null}>
      <div className="flex gap-2">
        {LANGS.map((l) => (
          <button key={l.code} onClick={() => setLang(l.code)}
            className={`flex-1 rounded-xl py-3 text-lg font-semibold ${lang === l.code ? "bg-[var(--brand)] text-white" : "bg-[var(--card)] ring-1 ring-black/10"}`}>
            {l.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-[var(--muted)]">{t("tagline")}</p>

      {profile && (
        <Card className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-soft)] text-2xl">🙂</div>
          <div className="flex-1">
            <div className="font-semibold">{t("hello")}, {profile.name}</div>
            <div className="text-xs text-[var(--muted)]">Class {profile.class} · {profile.taluka} · {profile.category}</div>
          </div>
          <select aria-label={t("demo_profile")} value={profile.id ?? ""} onChange={(e) => setProfile(data.students.find((s: any) => s.id === e.target.value))}
            className="rounded bg-[var(--bg)] px-2 py-1 text-sm">
            {data?.students.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            {profile.id === undefined && <option value="">{profile.name}</option>}
          </select>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        {TILES.map((x) => (
          <Link key={x.href} href={x.href} className={`flex aspect-square flex-col items-center justify-center rounded-2xl ${x.color} text-black shadow-sm active:scale-95`}>
            <span className="text-5xl">{x.icon}</span>
            <span className="mt-2 text-lg font-semibold">{t(x.key)}</span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {STAFF.map((x) => (
          <Link key={x.href} href={x.href} className="flex flex-col items-center rounded-xl bg-[var(--card)] py-3 text-sm ring-1 ring-black/5">
            <span className="text-2xl">{x.icon}</span>{t(x.key)}
          </Link>
        ))}
      </div>
      {data && (
        <p className="text-center text-xs text-[var(--muted)]">
          {t("live_data")}: {data.version.file} · {new Date(data.version.modified).toLocaleString()}
        </p>
      )}
    </Shell>
  );
}
