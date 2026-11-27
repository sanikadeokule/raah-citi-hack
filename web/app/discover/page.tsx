"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Discover: the ikigai conversation. The student tells Raah two circles (what they love, what they are good at) by
// tapping, typing or speaking. Raah checks the other two (what pays, what is needed near them) from the dataset, shows
// the careers where the circles overlap, and checks "can you get there". The student confirms every tag: AI never decides alone.
import Link from "next/link";
import { postAi, aiAvailable } from "@/lib/ai";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChatInput } from "@/components/chatinput";
import { Icon, Mark } from "@/components/icon";
import { MicButton, Shell, SpeakButton } from "@/components/ui";
import { inr } from "@/lib/engine";
import { GOOD_CHIPS, LOVE_CHIPS, ikigaiWeights, type Semantic, allTagsOf, extractTags, phrasesOf, reachable, sweetSpots, type Circle, type Check, type Spot, refiners } from "@/lib/ikigai";
import { tagLabel } from "@/lib/questions";
import { useApp } from "@/lib/store";

type Screen = "intro" | "love" | "good" | "confirm" | "checking" | "sweet" | "reach";
type Msg = { from: "raah" | "me"; text: string };
const CIRCLES: Circle[] = ["love", "good", "pays", "needed"];

function Pills({ screen, t }: { screen: Screen; t: (k: string) => string }) {
  const at = screen === "love" ? 0 : screen === "good" ? 1 : 2;
  const items = [`1 ${t("ik_p_love")}`, `2 ${t("ik_p_good")}`, `3 ${t("ik_raah_checks")}`];
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
  const { t, lang, data, profile, setProfile, queueAction } = useApp();
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("intro");
  const [love, setLove] = useState<string[]>(profile?.ikigai?.love ?? []);
  const [good, setGood] = useState<string[]>(profile?.ikigai?.good_at ?? []);
  const [loveWords, setLoveWords] = useState<string[]>(profile?.ikigai?.love_words ?? []);
  const [goodWords, setGoodWords] = useState<string[]>(profile?.ikigai?.good_words ?? []);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [turn, setTurn] = useState(0); // 0: the open question, 1: the follow-up
  const [follow, setFollow] = useState<string[]>([]); // the follow-up's reply chips: tags that sit beside what the student named
  const [voice, setVoice] = useState(false);
  const [adding, setAdding] = useState<"love" | "good" | null>(null);
  const [sel, setSel] = useState(0);
  const [done, setDone] = useState(0); // how many of the four checks Raah has finished showing
  const [pick, setPick] = useState<Spot | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const tags = useMemo(() => allTagsOf(data), [data]);
  const missing = !profile?.class || !profile?.category || !profile?.family_income_annual;
  const list = screen === "good" ? good : love;
  const setList = screen === "good" ? setGood : setLove;
  const words = screen === "good" ? goodWords : loveWords;
  const setWords = screen === "good" ? setGoodWords : setLoveWords;
  const stage = screen === "good" ? "good" : "love";
  const chips = (stage === "good" ? GOOD_CHIPS : LOVE_CHIPS).filter((x) => tags.includes(x)).slice(0, 5);
  // reply chips for the follow-up: each one stands for topics the dataset knows

  // closeness in meaning of what they said to every career (backend embedding model); empty when none is available
  const [semantic, setSemantic] = useState<Semantic>({});
  useEffect(() => {
    if (screen !== "checking") return;
    let live = true;
    const words = (tagList: string[], free: string[]) => [...tagList, ...free].join(", ");
    (async () => {
      const [l, g] = await Promise.all([
        words(love, loveWords) ? postAi("/api/interests/careers", { text: words(love, loveWords) }) : null,
        words(good, goodWords) ? postAi("/api/interests/careers", { text: words(good, goodWords) }) : null,
      ]);
      if (!live) return;
      const ls = l?.scores && Object.keys(l.scores).length ? l.scores : undefined;
      setSemantic({ love: ls, good: g?.scores && Object.keys(g.scores).length ? g.scores : undefined });
      if (ls && profile) {
        // the rest of the app ranks by profile.interests; saving these lets its top 5 use meaning too (30% keyword, 70% meaning)
        const prof = { ...profile, interest_meaning: { for: love, scores: ls } };
        setProfile(prof);
        await queueAction("profile", prof);
      }
    })();
    return () => { live = false; };
  }, [screen, love, good, loveWords, goodWords]);
  const spots = useMemo(() => (screen === "sweet" || screen === "checking" || screen === "reach") && data && profile ? sweetSpots(data, profile, love, good, semantic) : [], [screen, data, profile, love, good, semantic]);
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

  // Whatever the student says is kept. Raah maps it to topics it can check (the model when reachable, keywords otherwise);
  // words that map to no topic stay as the student's own phrases and are shown back and saved.
  // Each stage is two turns, as in the wireframe: the open question, then one follow-up with reply chips.
  const submit = async (said: string, forced: string[] = []) => {
    said = said.trim();
    if (!said || busy) return;
    say({ from: "me", text: said });
    setText("");
    setBusy(true);
    const local = [...new Set([...extractTags(said, tags), ...forced.filter((x) => tags.includes(x))])].slice(0, 4);
    let found = local, reply = "";
    if (!forced.length && (await aiAvailable())) {
      const r = await postAi("/api/chat/ikigai", { stage, text: said, lang, have: list });
      if (r && !r.fallback) { found = [...new Set([...local, ...(r.tags ?? [])])].slice(0, 4); reply = r.reply || ""; }
    }
    setList((l) => [...new Set([...l, ...found])]);
    const loose = forced.length ? [] : phrasesOf(said).filter((w) => extractTags(w, tags).length === 0 && !found.some((f) => w.toLowerCase().includes(f)));
    if (loose.length && !(reply && found.length)) setWords((w) => [...new Set([...w, ...loose])]);
    if (turn === 0) {
      // the follow-up is about what they just said: it names it and offers what usually goes with it in the dataset
      const anchor = found.length ? found : list.slice(-2);
      const chipsFor = anchor.length ? refiners(data, anchor, [...list, ...found]) : [];
      const named = anchor.length ? tagLabel(t, anchor[0]) : said.slice(0, 40);
      setFollow(chipsFor);
      // the model's own reply already says back what it understood; only without it do we name the topic ourselves
      const ack = reply || (stage === "love" && anchor.length ? t("ik_said", { a: named }) : t("ik_nice"));
      say({ from: "raah", text: `${ack} ${t(`${stage === "good" ? "ik_f_good" : "ik_f_love"}${chipsFor.length ? "" : "0"}`, { a: named })}` });
      setTurn(1);
    } else {
      setTurn(0); setMsgs([]);
      setScreen(stage === "love" ? "good" : "confirm");
    }
    setBusy(false);
  };
  const send = () => submit(text);
  const confirm = async () => {
    // what the student confirmed is saved to the profile; interests is what the rest of the app already ranks by
    const prof = { ...profile, interests: love, strengths: good, ikigai: { love, good_at: good, love_words: loveWords, good_words: goodWords, confirmed_at: new Date().toISOString() } };
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
    <Shell fit title={screen === "sweet" ? t("ik_sweet_title") : t("home_discover")} back={screen === "intro" ? "/" : null}>
      {screen === "intro" && (
        <div className="flex flex-1 flex-col gap-4">
          <div>
            <h2 className="text-2xl font-extrabold leading-tight text-[var(--brand-ink)]">{t("ik_intro_title")}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{t("ik_intro_body")}</p>
          </div>
          {/* the four circles: solid = the student tells Raah, dashed = Raah checks from data */}
          <svg viewBox="0 0 300 290" role="img" aria-label={`${t("ik_you_tell")}: ${t("ik_circle_love")}, ${t("ik_circle_good")}. ${t("ik_raah_checks")}: ${t("ik_circle_pays")}, ${t("ik_circle_needed")}.`} className="mx-auto w-full max-w-xs">
            {[[150, 78, "love", false], [88, 152, "good", false], [212, 152, "needed", true], [150, 214, "pays", true]].map(([cx, cy, k, dashed]) => (
              <circle key={k as string} cx={cx as number} cy={cy as number} r="64" fill={dashed ? "none" : "var(--brand)"} fillOpacity={dashed ? 0 : 0.14} stroke="var(--brand)" strokeWidth="2.5" strokeDasharray={dashed ? "7 6" : undefined} />
            ))}
            <g fontSize="9.5" fontWeight="700" fill="var(--ink)" textAnchor="middle">
              {([[150, 46, "ik_circle_love"], [52, 142, "ik_circle_good"], [252, 142, "ik_circle_needed"], [150, 246, "ik_circle_pays"]] as const).map(([x, y, k]) => {
                const w = t(k).split(" "); const lines: string[] = [];
                for (let i = 0; i < w.length; i += 2) lines.push(w.slice(i, i + 2).join(" "));
                return <text key={k} x={x} y={y}>{lines.map((l, i) => <tspan key={i} x={x} dy={i ? 11 : 0}>{l}</tspan>)}</text>;
              })}
            </g>
            <rect x="96" y="132" width="108" height="26" rx="13" fill="var(--card)" stroke="var(--brand)" strokeWidth="2" />
            <text x="150" y="149" textAnchor="middle" fontSize="11" fontWeight="800" fill="var(--ink)">{t("ik_sweet_title")}</text>
          </svg>
          <ul className="flex justify-center gap-5 text-sm">
            <li className="flex items-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-[var(--brand)] bg-[var(--brand)]/15" aria-hidden />{t("ik_you_tell")}</li>
            <li className="flex items-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-dashed border-[var(--brand)]" aria-hidden />{t("ik_i_check")}</li>
          </ul>
          {missing && (
            <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
              <p>{t("ik_basics_missing")}</p>
              <Link href="/discover/basics/" className="mt-2 inline-block font-bold underline">{t("ik_basics_go")}</Link>
            </div>
          )}
          <div className="mt-auto space-y-2">
            <button onClick={() => { setMsgs([]); setTurn(0); setVoice(false); setScreen("love"); }} className="w-full rounded-2xl bg-[var(--brand)] py-4 text-base font-bold text-white active:scale-[.98]">{t("ik_start")}</button>
            <button onClick={() => { setMsgs([]); setTurn(0); setVoice(true); setScreen("love"); }} className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-black/15 py-3.5 text-base font-bold active:scale-[.98]"><Icon name="mic" size={18} />{t("ik_voice_instead")}</button>
          </div>
        </div>
      )}

      {(screen === "love" || screen === "good") && (
        <div className="flex flex-1 flex-col gap-3">
          <Pills screen={screen} t={t} />
          {screen === "good" && (love.length > 0 || loveWords.length > 0) && (
            <div>
              <p className="mb-1 text-xs text-[var(--muted)]">{t("ik_heard_love")}</p>
              <div className="flex flex-wrap gap-2">
                {[...love.map((x) => ({ k: x, label: tagLabel(t, x), word: false })), ...loveWords.map((x) => ({ k: x, label: x, word: true }))].map((c) => (
                  <span key={`${c.word}-${c.k}`} className="inline-flex items-center gap-1 rounded-full border-2 border-black/15 py-0.5 pl-3 pr-1 text-sm font-medium">
                    {c.label}
                    <button onClick={() => (c.word ? setLoveWords((l) => l.filter((y) => y !== c.k)) : setLove((l) => l.filter((y) => y !== c.k)))} aria-label={t("ik_remove", { tag: c.label })} className="grid h-7 w-7 place-items-center rounded-full hover:bg-black/10"><Icon name="x" size={14} /></button>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2.5" aria-live="polite">
            <Guide>
              <p className="font-semibold">{stage === "good" ? t("ik_q_good") : t("ik_q_love")}</p>
              <div className="mt-1"><SpeakButton text={stage === "good" ? t("ik_q_good") : t("ik_q_love")} /></div>
            </Guide>
            {msgs.map((m, i) => m.from === "me"
              ? <div key={i} className="max-w-[85%] self-end rounded-2xl rounded-tr-sm bg-[var(--brand)] px-3.5 py-2.5 text-[15px] text-white">{m.text}</div>
              : <Guide key={i}><p>{m.text}</p></Guide>)}
          </div>
          <div ref={end} />
          <div className="mt-auto space-y-2">
            {voice && <p className="flex items-center gap-2 rounded-xl bg-[var(--brand-soft)] p-3 text-sm"><Icon name="mic" size={18} className="shrink-0 text-[var(--brand)]" />{t("ik_voice_note")}</p>}
            <div className="flex flex-wrap gap-2">
              {turn === 0
                ? chips.map((x) => <Chip key={x} onClick={() => submit(tagLabel(t, x), [x])}>{tagLabel(t, x)}</Chip>)
                : (follow.length ? follow : chips).map((x) => <Chip key={x} onClick={() => submit(tagLabel(t, x), [x])}>{tagLabel(t, x)}</Chip>)}
            </div>
            <div className="flex items-end gap-2">
              <MicButton onText={(s) => setText((x) => `${x} ${s}`.trim())} />
              <ChatInput value={text} onChange={setText} onSend={send} placeholder={t("ik_type")} />
              <button onClick={send} disabled={!text.trim() || busy} className="h-12 shrink-0 rounded-full bg-[var(--brand-soft)] px-4 text-sm font-bold text-[var(--brand-ink)] disabled:opacity-40">{t("ik_send")}</button>
            </div>
          </div>
        </div>
      )}

      {screen === "confirm" && (
        <div className="flex flex-1 flex-col gap-4">
          <div><h2 className="text-2xl font-extrabold text-[var(--brand-ink)]">{t("ik_confirm_title")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("ik_confirm_hint")}</p></div>
          <div className="space-y-4 xl:grid xl:grid-cols-2 xl:gap-4 xl:space-y-0">
          {([["love", "ik_love_h", love, setLove, loveWords, setLoveWords], ["good", "ik_good_h", good, setGood, goodWords, setGoodWords]] as const).map(([k, h, items, set, ws, setWs]) => (
            <section key={k} className="rounded-2xl bg-[var(--card)] p-4 ring-2 ring-black/10">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">{t(h)}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {items.map((x) => (
                  <span key={x} className="inline-flex items-center gap-1 rounded-full border-2 border-black/15 py-1 pl-3.5 pr-1.5 text-sm font-medium">
                    {tagLabel(t, x)}
                    <button onClick={() => (set as any)((l: string[]) => l.filter((y) => y !== x))} aria-label={t("ik_remove", { tag: tagLabel(t, x) })} className="grid h-6 w-6 place-items-center rounded-full hover:bg-black/10"><Icon name="x" size={14} /></button>
                  </span>
                ))}
                {ws.map((x) => (
                  <span key={`w-${x}`} className="inline-flex items-center gap-1 rounded-full border-2 border-black/15 py-1 pl-3.5 pr-1.5 text-sm font-medium">
                    {x}
                    <button onClick={() => (setWs as any)((l: string[]) => l.filter((y) => y !== x))} aria-label={t("ik_remove", { tag: x })} className="grid h-6 w-6 place-items-center rounded-full hover:bg-black/10"><Icon name="x" size={14} /></button>
                  </span>
                ))}
                <button onClick={() => setAdding(adding === k ? null : k)} aria-expanded={adding === k} className="rounded-full border-2 border-dashed border-black/30 px-3.5 py-1.5 text-sm font-semibold">{t("ik_add")}</button>
              </div>
              {adding === k && (
                <div className="mt-3 flex flex-wrap gap-2 rounded-xl bg-[var(--brand-soft)] p-3">
                  {tags.filter((x) => !items.includes(x)).map((x) => <Chip key={x} onClick={() => (set as any)((l: string[]) => [...l, x])}>{tagLabel(t, x)}</Chip>)}
                </div>
              )}
            </section>
          ))}
          </div>
          <p className="text-xs text-[var(--muted)]">{t("ik_confirm_next")}</p>
          <div className="mt-auto space-y-2">
            <button onClick={confirm} disabled={!love.length && !good.length} className="w-full rounded-2xl bg-[var(--brand)] py-4 text-base font-bold text-white active:scale-[.98] disabled:opacity-40">{t("ik_looks_right")}</button>
            <button onClick={() => { setMsgs([]); setTurn(0); setScreen("love"); }} className="w-full rounded-2xl border-2 border-black/15 py-3.5 text-base font-bold">{t("ik_try_again")}</button>
          </div>
        </div>
      )}

      {screen === "checking" && (
        <div className="space-y-4">
          <Pills screen="checking" t={t} />
          <h2 className="text-2xl font-extrabold text-[var(--brand-ink)]">{t("ik_checking_title")}</h2>
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
        <div className="flex flex-1 flex-col gap-3">
          <p className="text-sm text-[var(--muted)]">{t("ik_sweet_sub")}</p>
          {spots.length === 0 && <p className="rounded-2xl bg-[var(--card)] p-4 text-sm ring-1 ring-black/10">{t("ik_none_found")}</p>}
          <div className="flex flex-col gap-3 xl:grid xl:grid-cols-2">
          {spots.slice(0, 5).map((s, i) => (
            <button key={s.career.id} onClick={() => setSel(i)} aria-pressed={sel === i} className={`rounded-2xl bg-[var(--card)] p-4 text-left ${sel === i ? "ring-[3px] ring-[var(--brand)]" : "ring-2 ring-black/10"}`}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-lg font-extrabold leading-snug">{s.career.name}</span>
                {i === 0 && <span className="shrink-0 inline-block rounded-full border-2 border-[var(--brand)] px-2 py-0.5 text-[11px] font-bold uppercase text-[var(--brand-ink)]">{t("ik_best")}</span>}
              </span>
              <span className="mt-3 grid grid-cols-4 gap-2">
                {CIRCLES.map((c) => (
                  <span key={c} className="block text-[10px] font-semibold leading-tight text-[var(--muted)]">
                    <span className="block h-1.5 overflow-hidden rounded-full bg-black/10"><span className="block h-full rounded-full bg-[var(--brand)]" style={{ width: `${Math.round(s.parts[c] * 100)}%` }} /></span>
                    <span className="mt-1 block">{t(`ik_short_${c}`)} {Math.round(ikigaiWeights(data)[c] * 100)}%</span>
                  </span>
                ))}
              </span>
              <span className="mt-2 grid grid-cols-2 gap-1.5">{CIRCLES.map((c) => checkRow(s.checks[c], c))}</span>
            </button>
          ))}
          </div>
          <p className="text-[11px] text-[var(--muted)]">{t("ik_estimates")}</p>
          {spots[sel] && <button onClick={() => { setPick(spots[sel]); setScreen("reach"); }} className="mt-auto w-full rounded-2xl bg-[var(--brand)] py-4 text-base font-bold text-white active:scale-[.98]">{t("ik_see_reach", { career: spots[sel].career.name })}</button>}
        </div>
      )}

      {screen === "reach" && pick && (
        <div className="flex flex-1 flex-col gap-3">
          <h2 className="text-2xl font-extrabold text-[var(--brand-ink)]">{t("ik_reach_title")}</h2>
          <p className="text-lg font-bold leading-snug">{pick.career.name}</p>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">{t("ik_cost_way")}</h3>
          {!reach && <p className="rounded-2xl bg-[var(--card)] p-4 text-sm ring-1 ring-black/10">{t("ik_no_plan")}</p>}
          {reach && (
            <>
              <dl className="grid grid-cols-2 gap-2">
                {([["ik_cost_total", inr(reach.total)], ["ik_family_pays", t("ik_per_month", { amount: inr(reach.perMonth) })], ["ik_scholarships", String(reach.schol)], ["ik_paid_back", reach.payback ? t(reach.payback === 1 ? "ik_month_1" : "ik_months", { n: reach.payback }) : "—"]] as const).map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-[var(--card)] p-3 ring-1 ring-black/10"><dt className="text-[11px] text-[var(--muted)]">{t(k)}</dt><dd className="text-lg font-extrabold">{v}</dd></div>
                ))}
              </dl>
              {reach.centre && (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-[var(--card)] p-3 ring-2 ring-black/10">
                  <div><p className="text-sm font-bold">{t("ik_nearest")}</p><p className="text-xs text-[var(--muted)]">{reach.centre.name}{reach.centre.distance_km != null && reach.centre.distance_km >= 1 ? ` · ${t("ik_distance", { km: reach.centre.distance_km })}` : ""}</p></div>
                  <Link href="/colleges/" className="shrink-0 rounded-lg border-2 border-black/15 px-3 py-2 text-xs font-bold uppercase">{t("ik_map")}</Link>
                </div>
              )}
              <section className="rounded-xl bg-[var(--card)] p-3 ring-2 ring-black/10">
                <h3 className="text-sm font-bold">{t("ik_steps")}</h3>
                <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm">{reach.steps.map((x) => <li key={x}>{x}</li>)}</ol>
              </section>
            </>
          )}
          <p className="text-[11px] text-[var(--muted)]">{t("ik_estimates")}</p>
          <div className="mt-auto space-y-2">
            <button onClick={startPath} className="w-full rounded-2xl bg-[var(--brand)] py-4 text-base font-bold text-white active:scale-[.98]">{t("ik_start_path")}</button>
            <button onClick={() => setScreen("sweet")} className="w-full rounded-2xl border-2 border-black/15 py-3.5 text-base font-bold">{t("ik_pick_another")}</button>
          </div>
        </div>
      )}
    </Shell>
  );
}
