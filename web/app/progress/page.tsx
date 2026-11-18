"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { Badge, Card, Shell, Stat, Source } from "@/components/ui";
import { inr } from "@/lib/engine";
import { useApp } from "@/lib/store";
import { getKV } from "@/lib/db";
import { FOR_YOU } from "@/lib/lessons";
import Link from "next/link";

export default function Progress() {
  const { t, authFetch, auth, data } = useApp();
  const [progress, setProgress] = useState<any>(null);
  const [learnQuizzes, setLearnQuizzes] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await authFetch("/api/modules/progress");
      const body = await r.json();
      if (!r.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Could not load progress");
      setProgress(body); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load progress"); }
  }, [authFetch]);
  useEffect(() => { if (auth?.user.role === "student") load(); }, [auth, load]);
  useEffect(() => {
    if (!data) return;
    const topics = [...new Set([FOR_YOU, ...(data.lesson_topics || []).map((x: any) => x.id)])];
    Promise.all(topics.map((topic) => getKV<any>(`quiz_topic_${topic}`))).then((records) =>
      setLearnQuizzes(records.filter((r) => r && Number.isFinite(r.score) && Number.isFinite(r.total))));
  }, [data]);
  const moduleScores = (progress?.modules || []).filter((m: any) => m.score != null);
  const quizQuestionCount = moduleScores.reduce((n: number, m: any) => n + m.total, 0) + learnQuizzes.reduce((n, q) => n + q.total, 0);
  const quizCorrectCount = moduleScores.reduce((n: number, m: any) => n + m.score, 0) + learnQuizzes.reduce((n, q) => n + q.score, 0);
  const averageQuizScore = quizQuestionCount ? Math.round(quizCorrectCount / quizQuestionCount * 100) : null;

  return (
    <Shell title={t("progress_title")}>
      <Link href="/learn/" className="text-sm font-semibold text-[var(--brand-ink)] underline">← {t("home_learn")}</Link>
      {auth?.user.role !== "student" ? <Card>{t("progress_students_only")}</Card> : error ? <Card>{error}</Card> : !progress ? <Card>Loading…</Card> : <>
        <div className="grid grid-cols-2 gap-2">
          <Stat label={t("progress_completed")} value={`${progress.completed}/${progress.enrolled}`} />
          <Stat label={t("progress_score")} value={averageQuizScore == null ? "—" : `${averageQuizScore}%`}
            sub={`${progress.scores_recorded + learnQuizzes.length} ${t("progress_scores_recorded")}`} />
        </div>
        <Card>
          <h2 className="font-bold">💰 {t("progress_income_title")}</h2>
          {progress.income_outlook ? <>
            <p className="mt-1 text-sm font-semibold">{progress.income_outlook.career}</p>
            <p className="mt-1 text-sm">{progress.income_outlook.income || t("progress_income_unknown")}</p>
            {progress.income_outlook.training_income && <p className="mt-1 text-xs text-[var(--muted)]">{t("progress_training_income")}: {progress.income_outlook.training_income}</p>}
            <p className="mt-2 text-xs text-[var(--muted)]">{t("progress_income_note")}</p>
            <Source url={(progress.income_outlook.sources || []).join(" ; ")} date={progress.income_outlook.last_checked} />
          </> : <p className="mt-1 text-sm text-[var(--muted)]">{t("progress_no_outlook")}</p>}
        </Card>
        <Card>
          <h2 className="font-bold">📝 {t("progress_learn_quizzes")}</h2>
          {!learnQuizzes.length ? <p className="mt-2 text-sm text-[var(--muted)]">{t("progress_no_learn_quizzes")}</p> : (
            <ul className="mt-2 divide-y divide-black/5">
              {learnQuizzes.map((q) => (
                <li key={q.quiz} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span>{t("progress_quiz_topic", { topic: q.quiz.replace(/^topic_/, "") })}</span>
                  <span className="font-semibold">{q.score}/{q.total} · {new Date(q.at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/learn/" className="mt-2 inline-block text-sm font-semibold text-[var(--brand-ink)] underline">{t("progress_take_quiz")}</Link>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold">📚 {t("progress_modules")}</h2>
            <Badge>{progress.completed} {t("progress_completed_badge")}</Badge>
          </div>
          {!progress.modules.length ? <p className="mt-2 text-sm text-[var(--muted)]">{t("progress_no_modules")}</p> : (
            <ul className="mt-2 divide-y divide-black/5">
              {progress.modules.map((m: any, i: number) => (
                <li key={`${m.title}-${i}`} className="py-2 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <b>{m.title}</b><Badge tone={m.completed ? "green" : "amber"}>{m.completed ? t("progress_complete") : t("progress_in_progress")}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-[var(--muted)]">
                    <span>{t("progress_score")}: {m.score == null ? "—" : `${m.score}/${m.total}`}</span>
                    {m.paid > 0 && <span>{t("progress_paid")}: {inr(m.paid)}</span>}
                    <span>{t("progress_enrolled_date")}: {new Date(m.enrolled_at * 1000).toLocaleDateString()}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </>}
    </Shell>
  );
}
