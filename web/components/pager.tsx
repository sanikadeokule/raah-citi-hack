"use client";
// Page through a long list: usePaged() slices the items, <Pager> shows Previous / Page x of y / Next.
// The page goes back to 1 whenever `resetKey` changes (a new search, filter or plan).
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/store";

export function usePaged<T>(items: T[], size: number, resetKey: string) {
  const [page, setPage] = useState(1);
  const top = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setPage(1); }, [resetKey]);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, pages);
  const start = (current - 1) * size;
  const go = (p: number) => {
    setPage(Math.min(pages, Math.max(1, p)));
    // bring the start of the list back into view, below the sticky header
    const el = top.current;
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72, behavior: "smooth" });
  };
  return { pageItems: items.slice(start, start + size), page: current, pages, start, total: items.length, go, top };
}

export function Pager({ page, pages, start, shown, total, go }: {
  page: number; pages: number; start: number; shown: number; total: number; go: (p: number) => void;
}) {
  const { t } = useApp();
  if (pages <= 1) return null;
  const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold ring-1 ring-black/10 disabled:opacity-35";
  return (
    <nav aria-label={t("pg_nav")} className="mt-3 flex items-center justify-between gap-2">
      <button onClick={() => go(page - 1)} disabled={page === 1} className={`${btn} bg-[var(--bg)]`}>‹ {t("pg_prev")}</button>
      <span className="text-center text-xs text-[var(--muted)]" aria-live="polite">
        <span className="block font-semibold text-[var(--ink)]">{t("pg_page", { p: page, n: pages })}</span>
        {t("pg_showing", { a: start + 1, b: start + shown, n: total })}
      </span>
      <button onClick={() => go(page + 1)} disabled={page === pages} className={`${btn} bg-[var(--brand)] text-white`}>{t("pg_next")} ›</button>
    </nav>
  );
}
