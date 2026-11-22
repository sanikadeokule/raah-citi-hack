"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { Card, MicButton, Shell, SpeakButton } from "@/components/ui";
import { ChatInput } from "@/components/chatinput";
import { FOR_YOU, forYou, lessonTopics, lessons, quiz } from "@/lib/lessons";
import { useApp } from "@/lib/store";
import { StudentModules } from "@/components/modules";
import { FreeCourses } from "@/components/freecourses";
import { Tabs } from "@/components/tabs";
import { getKV, setKV } from "@/lib/db";
import { cachedAudio, fetchAudio, voiceAvailable } from "@/lib/audio";
import Link from "next/link";
import { postAi } from "@/lib/ai";

export default function Learn() {
  const { data, profile, lang, setLang, t, queueAction } = useApp();
  const all = useMemo(() => (data ? lessons(data, lang) : []), [data, lang]);
  const topics = useMemo(() => (data ? lessonTopics(data, lang, all) : []), [data, lang, all]);
  const mine = useMemo(() => (data ? forYou(data, profile, all) : []), [data, profile, all]);
  // the dropdown opens on the student's own careers; until we know their interests, on the basics
  const [picked, setPicked] = useState<string | null>(null);
  const topic = picked ?? (mine.length ? FOR_YOU : "basics");
  const ls = useMemo(() => (topic === FOR_YOU ? mine : all.filter((l) => l.topic === topic)), [topic, mine, all]);
  const qs = useMemo(() => quiz(ls), [ls]);
  const [done, setDone] = useState<string[]>([]);
  const [ans, setAns] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);
  const [learnQuestion, setLearnQuestion] = useState("");
  const [learnTurns, setLearnTurns] = useState<any[]>([]);
  const [asking, setAsking] = useState(false);
  const pickTopic = (id: string) => { setPicked(id); setAns({}); setChecked(false); };
  const [tab, setTab] = useState<"lessons" | "modules" | "courses" | "quiz">("lessons");
  useEffect(() => { getKV<string[]>("lessons_done").then((v) => v && setDone(v)); }, []);
  // audio files for offline lessons: which lessons already have one saved for the current text
  const [voice, setVoice] = useState(false);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { voiceAvailable().then(setVoice); }, []);
  useEffect(() => {
    Promise.all(ls.map(async (l) => [l.id, Boolean(await cachedAudio(lang, l.text))] as const)).then((e) => setSaved(Object.fromEntries(e)));
  }, [ls, lang]);
  const saveAll = async () => {
    setSaving(true);
    const next = { ...saved };
    for (const l of ls) if (!next[l.id]) next[l.id] = Boolean(await fetchAudio(lang, l.text, true));
    setSaved(next); setSaving(false);
  };
  const savedCount = ls.filter((l) => saved[l.id]).length;
  const markDone = async (id: string) => {
    if (done.includes(id)) return;
    const next = [...done, id];
    setDone(next); await setKV("lessons_done", next); await queueAction("lesson_done", { id, at: new Date().toISOString() });
  };
  const score = qs.reduce((a, q, i) => a + (ans[i] === q.answer ? 1 : 0), 0);
  const check = async () => {
    setChecked(true);
    const rec = { quiz: `topic_${topic}`, score, total: qs.length, at: new Date().toISOString() };
    await setKV(`quiz_topic_${topic}`, rec); await queueAction("quiz", rec);
  };
  const askLearn = async (question: string, responseLang = lang) => {
    question = question.trim();
    if (!question || asking) return;
    if (responseLang !== lang) setLang(responseLang);
    setLearnQuestion("");
    setAsking(true);
    const history = learnTurns.slice(-2).flatMap((turn) => [
      { role: "user", content: turn.question }, { role: "assistant", content: turn.answer },
    ]);
    const result = await postAi("/api/ask", { question, lang: responseLang, history, profile });
    setLearnTurns((turns) => [...turns, {
      question, answer: result?.answer || t("learn_ask_error"), lang: responseLang,
      citations: result?.citations || [],
    }]);
    setAsking(false);
  };
  return (
    <Shell title={t("home_learn")}>
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: "lessons", label: `🎧 ${t("learn_tab_lessons")}`, count: ls.length },
        { key: "courses", label: `🇮🇳 ${t("learn_tab_courses")}` },
        { key: "modules", label: `👩‍🏫 ${t("learn_tab_modules")}` },
        { key: "quiz", label: `📝 ${t("quiz")}`, count: qs.length },
      ]} />

      {/* one topic drives both the lessons and the quiz built from them */}
      {tab !== "modules" && tab !== "courses" && (
        <label className="block text-sm font-medium">
          {t("lesson_topic")}
          <select value={topic} onChange={(e) => pickTopic(e.target.value)}
            className="mt-1 block w-full rounded-lg bg-[var(--card)] px-3 py-2 text-base ring-1 ring-black/10">
            {mine.length > 0 && <option value={FOR_YOU}>⭐ {t("lesson_for_you")} ({mine.length})</option>}
            {topics.map((tp: any) => <option key={tp.id} value={tp.id}>{tp.name} ({all.filter((l) => l.topic === tp.id).length})</option>)}
          </select>
          {topic === FOR_YOU && <span className="mt-1 block text-xs font-normal text-[var(--muted)]">{t("lesson_for_you_note")}</span>}
        </label>
      )}

      {tab === "courses" && <FreeCourses />}

      {tab === "modules" && <StudentModules emptyText={t("learn_no_modules")} />}

      {tab === "lessons" && <Card>
        {voice ? (
          <button onClick={saveAll} disabled={saving || savedCount === ls.length}
            className="mb-3 w-full rounded-lg bg-[var(--brand-soft)] py-2 text-sm font-semibold text-[var(--brand-ink)] disabled:opacity-60">
            {savedCount === ls.length ? `✅ ${t("audio_saved")}` : saving ? "…" : `⬇️ ${t("save_audio_offline")} (${savedCount}/${ls.length})`}
          </button>
        ) : (
          <p className="mb-3 text-xs text-[var(--muted)]">{t("device_voice_note")}</p>
        )}
        {/* titles only; tap one to read or play it */}
        <ul className="space-y-2">
          {ls.map((l) => (
            <li key={l.id}>
              <details className="group rounded-xl bg-[var(--bg)]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3">
                  <b className="leading-snug">{done.includes(l.id) ? "✅ " : ""}{l.title}{saved[l.id] ? " 💾" : ""}</b>
                  <span aria-hidden className="shrink-0 text-lg text-[var(--muted)] transition-transform group-open:rotate-90">›</span>
                </summary>
                <div className="space-y-2 px-3 pb-3">
                  <span onClick={() => markDone(l.id)} className="inline-block"><SpeakButton text={l.text} cache /></span>
                  <p className="text-sm leading-relaxed text-[var(--muted)]">{l.text}</p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </Card>}

      {tab === "quiz" && <Card>
        <ol className="space-y-3">
          {qs.map((q, i) => (
            <li key={i}>
              <div className="text-sm font-medium">{i + 1}. {q.q}</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {q.options.map((o: string, j: number) => {
                  const picked = ans[i] === j;
                  const tone = checked ? (j === q.answer ? "bg-emerald-200 text-black" : picked ? "bg-rose-200 text-black" : "bg-[var(--bg)]") : picked ? "bg-[var(--brand)] text-white" : "bg-[var(--bg)]";
                  return <button key={j} disabled={checked} onClick={() => setAns({ ...ans, [i]: j })} className={`rounded-full px-3 py-1.5 text-sm ring-1 ring-black/10 ${tone}`}>{o}</button>;
                })}
              </div>
            </li>
          ))}
        </ol>
        {!checked ? (
          <button onClick={check} disabled={Object.keys(ans).length < qs.length} className="mt-3 w-full rounded-xl bg-[var(--brand)] py-3 font-semibold text-white disabled:opacity-40">{t("check")}</button>
        ) : (
          <div className="mt-3 rounded-xl bg-[var(--brand-soft)] p-3 text-center text-lg font-bold">{t("score")}: {score} / {qs.length}</div>
        )}
        <p className="mt-2 text-xs text-[var(--muted)]">Answers are saved on the phone and sync when you are back online.</p>
        <Link href="/progress/" className="mt-3 inline-block text-sm font-semibold text-[var(--brand-ink)] underline">{t("progress_view_dashboard")}</Link>
      </Card>}

      <Card>
        <h2 className="font-bold">💬 {t("learn_ask_title")}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">{t("learn_ask_hint")}</p>
        {learnTurns.map((turn, i) => (
          <div key={`${i}-${turn.question}`} className="mt-3 space-y-2 text-sm">
            <p className="rounded-xl bg-[var(--bg)] p-2">{turn.question}</p>
            <div className="rounded-xl bg-[var(--brand-soft)] p-2">
              <p className="whitespace-pre-line">{turn.answer}</p>
              <SpeakButton text={turn.answer} label="" lang={turn.lang} />
            </div>
          </div>
        ))}
        {asking && <p className="mt-2 text-sm text-[var(--muted)]">{t("thinking")}</p>}
        <div className="mt-3 flex items-end gap-2">
          <MicButton onText={(spoken, detectedLang) => askLearn(spoken, detectedLang || lang)} />
          <ChatInput value={learnQuestion} onChange={setLearnQuestion}
            onSend={() => askLearn(learnQuestion)} placeholder={t("learn_ask_placeholder")} maxLength={500} />
          <button onClick={() => askLearn(learnQuestion)} disabled={asking || !learnQuestion.trim()}
            className="rounded-full bg-[var(--brand)] px-4 py-3 text-white disabled:opacity-40">{t("send")}</button>
        </div>
      </Card>
    </Shell>
  );
}
