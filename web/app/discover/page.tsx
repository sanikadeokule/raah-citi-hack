"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Discover: the ikigai conversation. The student tells Raah two circles (what they love, what they are good at) by
// tapping, typing or speaking. Raah checks the other two (what pays, what is needed near them) from the dataset, shows
// the careers where the circles overlap, and checks "can you get there". The student confirms every tag: AI never decides alone.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChatInput } from "@/components/chatinput";
import { Icon, Mark } from "@/components/icon";
import { MicButton, Shell, SpeakButton } from "@/components/ui";
import { inr } from "@/lib/engine";
import { GOOD_CHIPS, LOVE_CHIPS, allTagsOf, extractTags, reachable, sweetSpots, type Circle, type Check, type Spot } from "@/lib/ikigai";
import { tagLabel } from "@/lib/questions";
import { useApp } from "@/lib/store";

type Screen = "intro" | "love" | "good" | "confirm" | "checking" | "sweet" | "reach";
type Msg = { from: "raah" | "me"; text: string };
const CIRCLES: Circle[] = ["love", "good", "pays", "needed"];

function Pills({ screen, t }: { screen: Screen; t: (k: string) => string }) {
  const at = screen === "love" ? 0 : screen === "good" ? 1 : 2;
  const items = [`1 ${t("ik_circle_love")}`, `2 ${t("ik_circle_good")}`, `3 ${t("ik_raah_checks")}`];
  return (
    <ol className="flex flex-wrap gap-1.5 text-xs font-bold" aria-label={t("ik_title")}>
      {items.map((x, i) => (
        <li key={x} aria-current={i === at ? "step" : undefined} className={`rounded-full px-3 py-1.5 ${i === at ? "bg-[var(--brand)] text-white" : i < at ? "bg-[var(--brand-soft)] text-[var(--brand-ink)]" : "bg-black/10 text-[var(--muted)]"}`}>
          {i < at && <Icon name="check" size={12} className="mr-1 align-[-1px]" />}{x}
        </li>
      ))}
    </ol>
  );
}

function Chip({ on, onClick, children }: { on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={`rounded-full px-3.5 py-2 text-sm font-medium ring-1 ring-black/10 active:scale-95 ${on ? "bg-[var(--brand)] text-white" : "bg-[var(--card)]"}`}>{children}</button>
  );
}

function Guide({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Icon name="compass" size={24} /></span>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-[var(--card)] p-3.5 text-[15px] leading-snug ring-1 ring-black/10">{children}</div>
    </div>
  );
}

export default function Discover() {
  const { t, data, profile, setProfile, queueAction } = useApp();
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("intro");
  const [love, setLove] = useState<string[]>(profile?.ikigai?.love ?? []);
  const [good, setGood] = useState<string[]>(profile?.ikigai?.good_at ?? []);
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [done, setDone] = useState(0); // how many of the four checks Raah has finished showing
  const [pick, setPick] = useState<Spot | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const tags = useMemo(() => allTagsOf(data), [data]);
  const missing = !profile?.class || !profile?.category || !profile?.family_income_annual;
  const list = screen === "good" ? good : love;
  const setList = screen === "good" ? setGood : setLove;
  const chips = screen === "good" ? GOOD_CHIPS : LOVE_CHIPS;

  const spots = useMemo(() => (screen === "sweet" || screen === "checking" || screen === "reach") && data && profile ? sweetSpots(data, profile, love, good) : [], [screen, data, profile, love, good]);
  const reach = useMemo(() => (pick && data && profile ? reachable(data, profile, pick) : null), [pick, data, profile]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [msgs, screen]);

  // Raah finishes its four checks one by one; people who asked for less motion see them at once
  useEffect(() => {
    if (screen !== "checking") return;
    setDone(0);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setDone(4); return; }
    const ids = [1, 2, 3, 4].map((n) => setTimeout(() => setDone(n), n * 650));
    return () => ids.forEach(clearTimeout);
  }, [screen]);

  const toggle = (tag: string) => setList((l) => (l.includes(tag) ? l.filter((x) => x !== tag) : [...l, tag]));
  const say = (m: Msg) => setMsgs((x) => [...x, m]);

  const send = () => {
    const found = extractTags(text, tags);
    if (!text.trim() && !list.length) return;
    if (text.trim()) say({ from: "me", text: text.trim() });
    const merged = [...new Set([...list, ...found])];
    setList(merged);
    setText("");
    say({ from: "raah", text: merged.length ? t("ik_heard", { tags: merged.map((x) => tagLabel(t, x)).join(", ") }) : t("ik_heard_none") });
  };
  const next = () => {
    if (screen === "love") { setMsgs([]); setScreen("good"); }
    else if (screen === "good") setScreen("confirm");
  };
  const confirm = async () => {
    // what the student confirmed is saved to the profile; interests is what the rest of the app already ranks by
    const prof = { ...profile, interests: love, strengths: good, ikigai: { love, good_at: good, confirmed_at: new Date().toISOString() } };
    setProfile(prof);
    await queueAction("profile", prof);
    setScreen("checking");
  };
  const startPath = async () => {
    if (!pick) return;
    const prof = { ...profile, roadmap_career: pick.career.id, roadmap_at: new Date().toISOString() };
    setProfile(prof);
    await queueAction("profile", prof);
    router.push(`/roadmap/?career=${pick.career.id}`);
  };

  const checkText = (c: Check, circle: Circle) => {
    if (circle === "pays") return t(c.level === "unknown" ? "ik_pays_unknown" : `ik_pays_${c.level}`, { amount: inr(Number(c.vars?.amount)) });
    if (circle === "needed") return c.level === "yes" && !c.vars?.n ? t("ik_needed_yes0") : t(`ik_needed_${c.level}`, { n: Number(c.vars?.n ?? 0) });
    return t(`ik_${circle}_${c.level}`);
  };
  const checkRow = (c: Check, circle: Circle) => (
    <span key={circle} className="flex items-start gap-1.5 rounded-lg bg-[var(--bg)] px-2 py-1.5 text-xs">
      <Mark kind={c.level === "yes" ? "yes" : c.level === "part" ? "warn" : c.level === "no" ? "no" : "unknown"} size={14} />
      <span>{checkText(c, circle)}</span>
    </span>
  );

  const question = screen === "good" ? { q: t("ik_q_good"), hint: t("ik_q_good_hint") } : { q: t("ik_q_love"), hint: t("ik_q_love_hint") };
  const moreTags = tags.filter((x) => !chips.includes(x));

  return (
    <Shell title={t("home_discover")} back={screen === "intro" ? "/" : null}>
      {screen === "intro" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-extrabold leading-tight text-[var(--brand-ink)]">{t("ik_intro_title")}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{t("ik_intro_body")}</p>
          </div>
          {/* the four circles: solid = the student tells Raah, dashed = Raah checks from data */}
          <svg viewBox="0 0 240 200" role="img" aria-label={`${t("ik_you_tell")}: ${t("ik_circle_love")}, ${t("ik_circle_good")}. ${t("ik_raah_checks")}: ${t("ik_circle_pays")}, ${t("ik_circle_needed")}.`} className="mx-auto w-full max-w-xs">
            {[[85, 70, "love", false], [155, 70, "good", false], [85, 130, "pays", true], [155, 130, "needed", true]].map(([cx, cy, k, dashed]) => (
              <circle key={k as string} cx={cx as number} cy={cy as number} r="52" fill={dashed ? "none" : "var(--brand)"} fillOpacity={dashed ? 0 : 0.12} stroke="var(--brand)" strokeWidth="2.5" strokeDasharray={dashed ? "6 5" : undefined} />
            ))}
            <g fontSize="9" fontWeight="700" fill="var(--ink)" textAnchor="middle">
              {([[64, 66, "ik_circle_love"], [176, 66, "ik_circle_good"], [64, 138, "ik_circle_pays"], [176, 138, "ik_circle_needed"]] as const).map(([x, y, k]) => {
                const w = t(k).split(" "); const cut = Math.ceil(w.length / 2);
                return <text key={k} x={x} y={y - 5}><tspan x={x}>{w.slice(0, cut).join(" ")}</tspan><tspan x={x} dy="11">{w.slice(cut).join(" ")}</tspan></text>;
              })}
            </g>
          </svg>
          <ul className="space-y-1 text-sm">
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-[var(--brand)]/30 ring-2 ring-[var(--brand)]" aria-hidden />{t("ik_you_tell")}</li>
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full ring-2 ring-dashed ring-[var(--brand)]" aria-hidden />{t("ik_raah_checks")}</li>
          </ul>
          <p className="flex items-center gap-2 rounded-xl bg-[var(--brand-soft)] p-3 text-sm"><Icon name="mic" size={18} className="shrink-0 text-[var(--brand)]" />{t("ik_voice_note")}</p>
          {missing && (
            <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
              <p>{t("ik_basics_missing")}</p>
              <Link href="/discover/basics/" className="mt-2 inline-block font-bold underline">{t("ik_basics_go")}</Link>
            </div>
          )}
          <button onClick={() => { setMsgs([]); setScreen("love"); }} className="w-full rounded-2xl bg-[var(--brand)] py-4 text-base font-bold text-white active:scale-[.98]">{t("ik_start")}</button>
        </div>
      )}

      {(screen === "love" || screen === "good") && (
        <div className="flex flex-1 flex-col gap-3">
          <Pills screen={screen} t={t} />
          <Guide>
            <p className="font-semibold">{question.q}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{question.hint}</p>
            <div className="mt-2"><SpeakButton text={`${question.q} ${question.hint}`} /></div>
          </Guide>
          <div className="flex flex-col gap-2" aria-live="polite">
            {msgs.map((m, i) => m.from === "me"
              ? <div key={i} className="max-w-[80%] self-end rounded-2xl rounded-tr-sm bg-[var(--brand)] px-3.5 py-2.5 text-sm text-white">{m.text}</div>
              : <div key={i} className="max-w-[88%] self-start rounded-2xl rounded-tl-sm bg-[var(--card)] px-3.5 py-2.5 text-sm ring-1 ring-black/10">{m.text}</div>)}
          </div>
          <div className="flex flex-wrap gap-2">
            {chips.filter((x) => tags.includes(x)).map((x) => <Chip key={x} on={list.includes(x)} onClick={() => toggle(x)}>{tagLabel(t, x)}</Chip>)}
            {list.filter((x) => !chips.includes(x)).map((x) => <Chip key={x} on onClick={() => toggle(x)}>{tagLabel(t, x)}</Chip>)}
            <button onClick={() => setShowAll((s) => !s)} aria-expanded={showAll} className="rounded-full px-3.5 py-2 text-sm font-semibold text-[var(--brand-ink)] underline">{t("ik_add_more")}</button>
          </div>
          {showAll && <div className="flex flex-wrap gap-2 rounded-2xl bg-[var(--brand-soft)] p-3">{moreTags.map((x) => <Chip key={x} on={list.includes(x)} onClick={() => toggle(x)}>{tagLabel(t, x)}</Chip>)}</div>}
          <div ref={end} />
          <div className="mt-auto space-y-2">
            <div className="flex items-end gap-2">
              <MicButton onText={(s) => setText((x) => `${x} ${s}`.trim())} />
              <ChatInput value={text} onChange={setText} onSend={send} placeholder={t("ik_type")} />
              <button onClick={send} disabled={!text.trim()} className="h-12 shrink-0 rounded-full bg-[var(--brand-soft)] px-4 text-sm font-bold text-[var(--brand-ink)] disabled:opacity-40">{t("ik_send")}</button>
            </div>
            <button onClick={() => { if (text.trim()) send(); next(); }} disabled={!list.length && !extractTags(text, tags).length}
              className="w-full rounded-2xl bg-[var(--brand)] py-4 text-base font-bold text-white active:scale-[.98] disabled:opacity-40">{t("ik_next")}</button>
          </div>
        </div>
      )}

      {screen === "confirm" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-extrabold text-[var(--brand-ink)]">{t("ik_confirm_title")}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{t("ik_confirm_hint")}</p>
          </div>
          {([["love", "ik_love_h", love, setLove], ["good", "ik_good_h", good, setGood]] as const).map(([k, h, items, set]) => (
            <section key={k} className="rounded-2xl bg-[var(--card)] p-4 ring-1 ring-black/10">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">{t(h)}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {items.length === 0 && <span className="text-sm text-[var(--muted)]">{t("ik_none_yet")}</span>}
                {items.map((x) => (
                  <span key={x} className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-soft)] py-1.5 pl-3.5 pr-1.5 text-sm font-medium text-[var(--brand-ink)]">
                    {tagLabel(t, x)}
                    <button onClick={() => (set as any)((l: string[]) => l.filter((y) => y !== x))} aria-label={t("ik_remove", { tag: tagLabel(t, x) })} className="grid h-6 w-6 place-items-center rounded-full hover:bg-black/10"><Icon name="x" size={14} /></button>
                  </span>
                ))}
              </div>
            </section>
          ))}
          <div className="space-y-2">
            <button onClick={confirm} disabled={!love.length && !good.length} className="w-full rounded-2xl bg-[var(--brand)] py-4 text-base font-bold text-white active:scale-[.98] disabled:opacity-40">{t("ik_looks_right")}</button>
            <button onClick={() => { setMsgs([]); setScreen("love"); }} className="w-full py-2 text-sm font-semibold text-[var(--brand-ink)] underline">{t("ik_try_again")}</button>
          </div>
        </div>
      )}

      {screen === "checking" && (
        <div className="space-y-4">
          <Pills screen="checking" t={t} />
          <Guide><p>{t("ik_checking_say")}</p></Guide>
          <ul className="space-y-2" aria-live="polite">
            {([["ik_chk_match", t("ik_chk_match_sub", { n: data?.careers?.length ?? 0 })], ["ik_chk_pay", t("ik_chk_pay_sub")], ["ik_chk_open", t("ik_chk_open_sub")], ["ik_chk_reach", t("ik_chk_reach_sub")]] as const).map(([k, sub], i) => (
              <li key={k} className={`flex items-start gap-3 rounded-xl bg-[var(--card)] p-3.5 ring-1 ring-black/10 ${i >= done ? "opacity-50" : ""}`}>
                <span aria-hidden className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${i < done ? "border-[var(--good)] text-[var(--good)]" : "border-dashed border-[var(--muted)] text-[var(--muted)]"}`}>{i < done ? <Icon name="check" size={14} /> : null}</span>
                <span><span className="block text-sm font-bold">{t(k)}</span><span className="block text-xs text-[var(--muted)]">{sub}</span></span>
                {i < done && <span className="sr-only">{t("ik_see_result")}</span>}
              </li>
            ))}
          </ul>
          <p className="text-center text-xs text-[var(--muted)]">{t("ik_checking_note")}</p>
          {done >= 4 && <button onClick={() => setScreen("sweet")} className="w-full rounded-2xl bg-[var(--brand)] py-4 text-base font-bold text-white active:scale-[.98]">{t("ik_see_result")}</button>}
        </div>
      )}

      {screen === "sweet" && (
        <div className="space-y-3">
          <div>
            <h2 className="text-2xl font-extrabold text-[var(--brand-ink)]">{t("ik_sweet_title")}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{t("ik_sweet_sub")}</p>
          </div>
          {spots.length === 0 && <p className="rounded-2xl bg-[var(--card)] p-4 text-sm ring-1 ring-black/10">{t("ik_none_found")}</p>}
          {spots.slice(0, 3).map((s, i) => (
            <section key={s.career.id} className={`rounded-2xl bg-[var(--card)] p-4 ${i === 0 ? "ring-2 ring-[var(--brand)]" : "ring-1 ring-black/10"}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-lg font-extrabold leading-snug">{s.career.name}</h3>
                {i === 0 && <span className="shrink-0 rounded-full border-2 border-[var(--brand)] px-2 py-0.5 text-[11px] font-bold text-[var(--brand-ink)]">{t("ik_best")}</span>}
              </div>
              <div className="mt-2 grid gap-1.5">{CIRCLES.map((c) => checkRow(s.checks[c], c))}</div>
              <button onClick={() => { setPick(s); setScreen("reach"); }} className={`mt-3 w-full rounded-xl py-3 text-sm font-bold active:scale-[.98] ${i === 0 ? "bg-[var(--brand)] text-white" : "bg-[var(--brand-soft)] text-[var(--brand-ink)]"}`}>{t("ik_see_reach", { career: s.career.name })}</button>
            </section>
          ))}
          <p className="text-[11px] text-[var(--muted)]">{t("ik_estimates")}</p>
          <button onClick={() => { setMsgs([]); setScreen("love"); }} className="w-full py-2 text-sm font-semibold text-[var(--brand-ink)] underline">{t("ik_try_again")}</button>
        </div>
      )}

      {screen === "reach" && pick && (
        <div className="space-y-3">
          <h2 className="text-2xl font-extrabold text-[var(--brand-ink)]">{t("ik_reach_title")}</h2>
          <p className="text-lg font-bold">{pick.career.name}</p>
          {!reach && <p className="rounded-2xl bg-[var(--card)] p-4 text-sm ring-1 ring-black/10">{t("ik_no_plan")}</p>}
          {reach && (
            <>
              <dl className="grid grid-cols-2 gap-2">
                {([["ik_cost_total", inr(reach.total)], ["ik_family_pays", t("ik_per_month", { amount: inr(reach.perMonth) })], ["ik_scholarships", String(reach.schol)]] as const).map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-[var(--card)] p-3 ring-1 ring-black/10"><dt className="text-[11px] text-[var(--muted)]">{t(k)}</dt><dd className="text-lg font-extrabold">{v}</dd></div>
                ))}
                <div className="rounded-xl bg-[var(--card)] p-3 ring-1 ring-black/10"><dt className="text-[11px] text-[var(--muted)]">{t("ik_circle_pays")}</dt><dd className="text-lg font-extrabold">{pick.checks.pays.level === "unknown" ? "—" : inr(Number(pick.checks.pays.vars?.amount))}<span className="text-xs font-medium text-[var(--muted)]"> /{t("rm_month")}</span></dd></div>
              </dl>
              {reach.centre && (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-[var(--card)] p-3 ring-1 ring-black/10">
                  <div><p className="text-sm font-bold">{t("ik_nearest")}</p><p className="text-xs text-[var(--muted)]">{reach.centre.name}{reach.centre.distance_km != null && reach.centre.distance_km >= 1 ? ` · ${t("ik_distance", { km: reach.centre.distance_km })}` : ""}</p></div>
                  <Link href="/colleges/" className="shrink-0 rounded-lg border-2 border-black/15 px-3 py-2 text-xs font-bold">{t("home_colleges")}</Link>
                </div>
              )}
              <section className="rounded-xl bg-[var(--card)] p-3 ring-1 ring-black/10">
                <h3 className="text-sm font-bold">{t("ik_steps")}</h3>
                <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm">{reach.steps.map((s) => <li key={s}>{s}</li>)}</ol>
              </section>
            </>
          )}
          <p className="text-[11px] text-[var(--muted)]">{t("ik_estimates")}</p>
          <div className="space-y-2">
            <button onClick={startPath} className="w-full rounded-2xl bg-[var(--brand)] py-4 text-base font-bold text-white active:scale-[.98]">{t("ik_start_path")}</button>
            <button onClick={() => setScreen("sweet")} className="w-full rounded-2xl border-2 border-black/15 py-3 text-sm font-bold">{t("ik_pick_another")}</button>
          </div>
        </div>
      )}
    </Shell>
  );
}
