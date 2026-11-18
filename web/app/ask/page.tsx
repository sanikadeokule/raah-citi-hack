"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Ask Raah: free questions answered from raah-dataset.xlsx by an agent (backend/raah/agent.py).
// The agent calls tools on the raah-data MCP server (rank careers, check eligibility, colleges, exams...),
// and each tool call streams in as a small grey bubble while it works. Every figure in the answer must
// come from a tool result; otherwise, or if streaming fails, the one-shot RAG answer (/api/ask) is shown.
import { useEffect, useRef, useState } from "react";
import { Card, MicButton, Shell, SpeakButton } from "@/components/ui";
import { ChatInput } from "@/components/chatinput";
import { postAi } from "@/lib/ai";
import { useApp } from "@/lib/store";

type Cite = { n: number; sheet: string; row_id: string; title: string; excel_rows: number[]; source: string; summary: string };
type Step = { n: number; tool: string; label: string; summary?: string; done?: boolean };
type Msg = { from: "me" | "raah"; text: string; cites?: Cite[]; note?: string; steps?: Step[] };

const EXAMPLES = ["ask_ex1", "ask_ex2", "ask_ex3"];

/** "[2]" in the answer becomes a small link to citation 2 below it. */
function withCites(text: string, id: number) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    return m ? <a key={i} href={`#c${id}-${m[1]}`} className="ml-0.5 align-super text-[10px] font-bold text-[var(--brand)]">{m[1]}</a> : <span key={i}>{part}</span>;
  });
}

/** One tool call by the agent: a small grey bubble, "Checking eligibility…" then "✓ Checking eligibility · 3 schemes". */
function StepBubble({ s, label }: { s: Step; label: string }) {
  return (
    <div className="max-w-[88%] rounded-2xl bg-black/5 px-3 py-1 text-xs text-[var(--muted)]">
      {s.done ? "✓" : <span className="inline-block animate-pulse">⋯</span>} {label}{s.done ? "" : "…"}
      {s.summary && <span className="opacity-80"> · {s.summary}</span>}
    </div>
  );
}

export default function AskPage() {
  const { t, lang, profile, online, authFetch } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Step[]>([]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy, live]);

  /** Runs the agent over Server-Sent Events, showing each tool step as it happens. Null if the stream fails. */
  const askAgent = async (body: unknown): Promise<any | null> => {
    try {
      const r = await authFetch("/api/agent/ask", { method: "POST", body: JSON.stringify(body), headers: { Accept: "text/event-stream" } });
      if (!r.ok || !r.body) return null;
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "", answer: any = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "step") setLive((s) => [...s, { n: ev.n, tool: ev.tool, label: ev.label }]);
          else if (ev.type === "step_done") setLive((s) => s.map((x) => (x.n === ev.n ? { ...x, summary: ev.summary, done: true } : x)));
          else if (ev.type === "answer") answer = ev;
          else if (ev.type === "error") return null;
        }
      }
      return answer;
    } catch {
      return null;
    }
  };

  const stepLabel = (s: Step) => { const k = `agent_${s.tool}`; const v = t(k); return v === k ? s.label : v; };

  const ask = async (q: string) => {
    q = q.trim();
    if (!q || busy) return;
    setText("");
    const history = msgs.slice(-4).map((m) => ({ role: m.from === "me" ? "user" : "assistant", content: m.text }));
    setMsgs((m) => [...m, { from: "me", text: q }]);
    setBusy(true);
    setLive([]);
    const body = { question: q, lang, history, profile };
    const j = (await askAgent(body)) ?? (await postAi("/api/ask", body));
    setBusy(false);
    setLive([]);
    if (!j) return setMsgs((m) => [...m, { from: "raah", text: t("ask_offline") }]);
    const ungrounded = j.grounded === false || (j.agent_fallback ?? "").startsWith("model used a figure");
    const note = j.fallback || ungrounded ? (ungrounded ? t("ask_note_ungrounded") : t("ask_note_no_ai")) : undefined;
    const steps: Step[] | undefined = j.steps?.map((s: any) => ({ n: s.n, tool: s.tool, label: s.label, summary: s.summary, done: true }));
    setMsgs((m) => [...m, { from: "raah", text: j.answer, cites: j.citations, note, steps }]);
  };

  return (
    <Shell title={t("home_ask")}>
      {msgs.length === 0 && (
        <Card>
          <p className="text-sm">{t("ask_intro")}</p>
          <div className="mt-3 flex flex-col gap-2">
            {EXAMPLES.map((k) => (
              <button key={k} onClick={() => ask(t(k))} className="rounded-xl bg-[var(--bg)] px-3 py-2 text-left text-sm ring-1 ring-black/10">💬 {t(k)}</button>
            ))}
          </div>
        </Card>
      )}
      <div className="space-y-2">
        {msgs.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.from === "me" ? "items-end" : "items-start"}`}>
            {m.steps && m.steps.length > 0 && (
              <details className="mb-1 max-w-[88%] text-xs text-[var(--muted)]">
                <summary className="cursor-pointer select-none">🧭 {t("agent_how", { n: m.steps.length })}</summary>
                <div className="mt-1 flex flex-col items-start gap-1">{m.steps.map((s) => <StepBubble key={s.n} s={s} label={stepLabel(s)} />)}</div>
              </details>
            )}
            <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${m.from === "me" ? "bg-[var(--brand)] text-white" : "bg-[var(--card)] ring-1 ring-black/5"}`}>
              <div className="whitespace-pre-line">{m.from === "raah" ? withCites(m.text, i) : m.text}</div>
              {m.note && <div className="mt-1 text-xs text-[var(--muted)]">ℹ️ {m.note}</div>}
              {m.cites && m.cites.length > 0 && (
                <ol className="mt-2 space-y-1 border-t border-black/10 pt-2">
                  {m.cites.map((c) => (
                    <li key={c.n} id={`c${i}-${c.n}`} className="text-xs text-[var(--muted)]">
                      <span className="font-bold text-[var(--brand)]">[{c.n}]</span>{" "}
                      <span className="font-medium text-[var(--fg,inherit)]">{c.title}</span>
                      {" · "}{c.sheet}{c.row_id && c.row_id !== c.sheet ? ` ${c.row_id}` : ""}
                      {c.excel_rows?.length ? ` · ${t("ask_row")} ${c.excel_rows.join(", ")}` : ""}
                      {c.source && <> · <a href={c.source.split(" ; ")[0]} target="_blank" rel="noreferrer" className="underline">{t("source")}</a></>}
                    </li>
                  ))}
                </ol>
              )}
              {m.from === "raah" && i === msgs.length - 1 && <div className="mt-1"><SpeakButton text={m.text.replace(/\[\d+\]/g, "")} label="" /></div>}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex flex-col items-start gap-1">
            {live.map((s) => <StepBubble key={s.n} s={s} label={stepLabel(s)} />)}
            <div className="text-sm text-[var(--muted)]">🔎 {live.length ? t("agent_thinking") : t("ask_searching")}</div>
          </div>
        )}
        <div ref={end} />
      </div>
      <Card className="sticky bottom-2">
        {!online && <p className="mb-2 text-xs text-amber-700">{t("ask_offline")}</p>}
        <div className="flex items-end gap-2">
          <MicButton onText={(s) => ask(s)} />
          <ChatInput value={text} onChange={setText} onSend={() => { if (!busy && text.trim()) ask(text); }}
            placeholder={t("ask_placeholder")} maxLength={500} />
          <button onClick={() => ask(text)} disabled={busy || !text.trim()} className="rounded-full bg-[var(--brand)] px-4 py-3 text-white disabled:opacity-40">{t("send")}</button>
        </div>
      </Card>
    </Shell>
  );
}
