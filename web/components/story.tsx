"use client";
// The first thing a new student sees: a short story (Sana's) told in tappable scenes, ending in
// "your turn". Scenes advance on their own; tap right/left to move, press and hold to pause.
// With reduced motion the story does not advance by itself. The roadmap button is always visible.
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";

const SCENES = [
  { icon: "🌄", bg: "linear-gradient(160deg,#3d2a6b 0%,#b5476b 100%)", extra: "none" },
  { icon: "🗣️", bg: "linear-gradient(160deg,#14506b 0%,#2a8f8a 100%)", extra: "chips" },
  { icon: "🧭", bg: "linear-gradient(160deg,#1b3a6b 0%,#3d6bb3 100%)", extra: "path" },
  { icon: "🎓", bg: "linear-gradient(160deg,#5a3a0b 0%,#c27a1a 100%)", extra: "count" },
  { icon: "💰", bg: "linear-gradient(160deg,#0f4d2a 0%,#2f9a52 100%)", extra: "payback" },
  { icon: "✨", bg: "linear-gradient(160deg,#6b1f3a 0%,#f28c28 100%)", extra: "none" },
] as const;
const SCENE_MS = 5200;

function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setN(to); return; }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 1400);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{n}</>;
}

export function HomeStory({ href }: { href: string }) {
  const { t, data } = useApp();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const last = SCENES.length - 1;
  const go = (d: number) => setI((x) => Math.min(last, Math.max(0, x + d)));
  const s = SCENES[i];
  const nSchemes = data?.scholarships?.length ?? 0;
  const nCareers = data?.careers?.length ?? 0;

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden rounded-3xl text-white shadow-sm transition-[background] duration-700"
      style={{ background: s.bg }}>
      {/* progress: one bar per scene, the current one fills; when it finishes the story moves on */}
      <div className="flex gap-1 px-4 pt-3" aria-hidden>
        {SCENES.map((_, k) => (
          <span key={k} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
            {(k < i || (k === i && i === last)) && <span className="block h-full w-full bg-white" />}
            {k === i && i !== last && (
              <span key={`fill-${i}`} className="story-fill block h-full bg-white"
                style={{ animationDuration: `${SCENE_MS}ms`, animationPlayState: paused ? "paused" : "running" }}
                onAnimationEnd={() => go(1)} />
            )}
          </span>
        ))}
      </div>

      <div className="relative flex flex-1 flex-col">
        {/* tap zones: left goes back, right goes forward, holding anywhere pauses */}
        <button aria-label={t("story_prev")} onClick={() => go(-1)} className="absolute inset-y-0 left-0 z-10 w-1/3"
          onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)} />
        <button aria-label={t("story_next")} onClick={() => go(1)} className="absolute inset-y-0 right-0 z-10 w-2/3"
          onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)} />

        <div key={i} className="story-in flex flex-1 flex-col items-center justify-center px-6 py-4 text-center" aria-live="polite">
          <span className="story-float text-7xl leading-none">{s.icon}</span>
          <span className="mt-4 text-xs font-semibold uppercase tracking-wider text-white/75">{t(`story_${i}_kicker`)}</span>
          <span className="mt-1 text-2xl font-bold leading-tight">{t(`story_${i}_title`)}</span>
          <span className="mt-2 text-sm leading-snug text-white/90">
            {t(`story_${i}_body`, { schemes: nSchemes, careers: nCareers })}
          </span>

          {s.extra === "chips" && (
            <span className="mt-4 flex flex-wrap justify-center gap-2">
              {[t("story_chip_1"), t("story_chip_2"), t("story_chip_3"), t("story_chip_4")].map((c, k) => (
                <span key={c} className="story-pop rounded-full bg-white/20 px-3 py-1 text-sm font-semibold ring-1 ring-white/40"
                  style={{ animationDelay: `${300 + k * 350}ms` }}>{c}</span>
              ))}
            </span>
          )}

          {s.extra === "path" && (
            <span className="mt-4 flex items-center gap-1 text-sm font-semibold">
              {[t("story_path_1"), t("story_path_2"), t("story_path_3")].map((p, k) => (
                <span key={p} className="flex items-center gap-1">
                  {k > 0 && <span className="story-pop text-white/70" style={{ animationDelay: `${k * 600}ms` }}>→</span>}
                  <span className="story-pop rounded-xl bg-white/20 px-2.5 py-1.5 ring-1 ring-white/40" style={{ animationDelay: `${200 + k * 600}ms` }}>{p}</span>
                </span>
              ))}
            </span>
          )}

          {s.extra === "count" && nSchemes > 0 && (
            <span className="mt-4 flex flex-col items-center">
              <span className="text-6xl font-extrabold leading-none tabular-nums"><CountUp to={nSchemes} /></span>
              <span className="mt-1 text-xs text-white/80">{t("story_count_label")}</span>
            </span>
          )}

          {s.extra === "payback" && (
            <span className="mt-5 w-full max-w-xs">
              <span className="flex justify-between text-[11px] text-white/80"><span>{t("story_fees")}</span><span>{t("story_paid_back")} ✅</span></span>
              <span className="mt-1 block h-3 overflow-hidden rounded-full bg-white/20">
                <span className="story-grow block h-full rounded-full bg-gradient-to-r from-amber-300 to-emerald-300" />
              </span>
            </span>
          )}
        </div>
      </div>

      {/* always reachable: nobody has to watch the whole story */}
      <div className="relative z-20 px-4 pb-4">
        <Link href={href}
          className={`flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-base font-bold text-[#12294d] shadow active:scale-95 ${i === last ? "story-pulse" : ""}`}>
          🗺️ {t("story_cta")} →
        </Link>
        <p className="mt-2 text-center text-[11px] text-white/80">{t("story_cta_sub")}</p>
      </div>
    </div>
  );
}
