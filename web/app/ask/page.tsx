"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Ask Raah: free questions answered from raah-dataset.xlsx (backend/raah/rag.py).
// Hybrid search finds the matching sheet rows, the LLM answers only from them, and every
// fact carries a numbered citation back to the sheet row and its official source.
import { useEffect, useRef, useState } from "react";
import { Card, MicButton, Shell, SpeakButton } from "@/components/ui";
import { ChatInput } from "@/components/chatinput";
import { postAi } from "@/lib/ai";
import { useApp } from "@/lib/store";

type Cite = { n: number; sheet: string; row_id: string; title: string; excel_rows: number[]; source: string; summary: string };
type Msg = { from: "me" | "raah"; text: string; cites?: Cite[]; note?: string };

const EXAMPLES = ["ask_ex1", "ask_ex2", "ask_ex3"];

/** "[2]" in the answer becomes a small link to citation 2 below it. */
function withCites(text: string, id: number) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    return m ? <a key={i} href={`#c${id}-${m[1]}`} className="ml-0.5 align-super text-[10px] font-bold text-[var(--brand)]">{m[1]}</a> : <span key={i}>{part}</span>;
  });
}

export default function AskPage() {
  const { t, lang, profile, online } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  const ask = async (q: string) => {
    q = q.trim();
    if (!q || busy) return;
    setText("");
    const history = msgs.slice(-4).map((m) => ({ role: m.from === "me" ? "user" : "assistant", content: m.text }));
    setMsgs((m) => [...m, { from: "me", text: q }]);
    setBusy(true);
    const j = await postAi("/api/ask", { question: q, lang, history, profile });
    setBusy(false);
    if (!j) return setMsgs((m) => [...m, { from: "raah", text: t("ask_offline") }]);
    const note = j.fallback ? (j.grounded === false ? t("ask_note_ungrounded") : t("ask_note_no_ai")) : undefined;
    setMsgs((m) => [...m, { from: "raah", text: j.answer, cites: j.citations, note }]);
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
          <div key={i} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
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
        {busy && <div className="text-sm text-[var(--muted)]">🔎 {t("ask_searching")}</div>}
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
