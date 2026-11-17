"use client";
// Message box for the chats (Discover, Ask Raah): wraps and grows as you type, like WhatsApp, so the
// whole message stays visible. Enter sends; Shift+Enter adds a line. Grows to about six lines, then scrolls.
import { useLayoutEffect, useRef } from "react";

const MAX_PX = 144;

export function ChatInput({ value, onChange, onSend, placeholder, inputMode, maxLength }: {
  value: string; onChange: (v: string) => void; onSend: () => void;
  placeholder?: string; inputMode?: "text" | "numeric"; maxLength?: number;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_PX)}px`;
    el.style.overflowY = el.scrollHeight > MAX_PX ? "auto" : "hidden";
  }, [value]);
  return (
    <textarea ref={ref} rows={1} value={value} placeholder={placeholder} inputMode={inputMode} maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        // Enter sends; Shift+Enter is a new line; never send mid-word while an Indic keyboard is composing
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend(); }
      }}
      className="block max-h-36 min-h-[3rem] min-w-0 flex-1 resize-none rounded-3xl bg-[var(--bg)] px-4 py-3 leading-6" />
  );
}
