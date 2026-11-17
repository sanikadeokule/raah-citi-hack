"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { Card, Shell, SpeakButton } from "@/components/ui";
import { FOR_YOU, forYou, lessonTopics, lessons, quiz } from "@/lib/lessons";
import { useApp } from "@/lib/store";
import { StudentModules } from "@/components/modules";
import { getKV, setKV } from "@/lib/db";
import { cachedAudio, fetchAudio, voiceAvailable } from "@/lib/audio";

export default function Learn() {
  const { data, profile, lang, t, queueAction } = useApp();
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
  const pickTopic = (id: string) => { setPicked(id); setAns({}); setChecked(false); };
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
  return (
    <Shell title={t("home_learn")}>
      <Card>
        <h2 className="mb-2 text-lg font-bold">🎧 {t("lessons")}</h2>
        <label className="mb-3 block text-sm font-medium">
          {t("lesson_topic")}
          <select value={topic} onChange={(e) => pickTopic(e.target.value)}
            className="mt-1 block w-full rounded-lg bg-[var(--bg)] px-3 py-2 text-base ring-1 ring-black/10">
            {mine.length > 0 && <option value={FOR_YOU}>⭐ {t("lesson_for_you")} ({mine.length})</option>}
            {topics.map((tp: any) => <option key={tp.id} value={tp.id}>{tp.name} ({all.filter((l) => l.topic === tp.id).length})</option>)}
          </select>
        </label>
        {topic === FOR_YOU && <p className="mb-3 text-xs text-[var(--muted)]">{t("lesson_for_you_note")}</p>}
        {voice ? (
          <button onClick={saveAll} disabled={saving || savedCount === ls.length}
            className="mb-3 w-full rounded-lg bg-[var(--brand-soft)] py-2 text-sm font-semibold text-[var(--brand-ink)] disabled:opacity-60">
            {savedCount === ls.length ? `✅ ${t("audio_saved")}` : saving ? "…" : `⬇️ ${t("save_audio_offline")} (${savedCount}/${ls.length})`}
          </button>
        ) : (
          <p className="mb-3 text-xs text-[var(--muted)]">{t("device_voice_note")}</p>
        )}
        <ul className="space-y-3">
          {ls.map((l) => (
            <li key={l.id} className="rounded-xl bg-[var(--bg)] p-3">
              <div className="flex items-center justify-between gap-2">
                <b>{done.includes(l.id) ? "✅ " : ""}{l.title}{saved[l.id] ? " 💾" : ""}</b>
                <span onClick={() => markDone(l.id)}><SpeakButton text={l.text} cache /></span>
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">{l.text}</p>
            </li>
          ))}
        </ul>
      </Card>
      <StudentModules />
      <Card>
        <h2 className="mb-2 text-lg font-bold">📝 {t("quiz")}</h2>
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
      </Card>
    </Shell>
  );
}
