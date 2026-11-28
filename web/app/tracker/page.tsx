"use client";
// Application tracker (Raah Pro): a Kanban board for college and scholarship applications.
// Columns: Researching → Applied → Documents Submitted → Waiting → Result
// Students can move cards between columns, add notes and deadlines, and add new cards.
// The board is seeded from the student's roadmap on first load.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Icon } from "@/components/icon";
import { useEffect, useRef, useState } from "react";
import { Badge, Card, Shell } from "@/components/ui";
import { ProBadge, ProGate, useText } from "@/components/pro";
import { API, useApp } from "@/lib/store";


type Col = "researching" | "applied" | "docs_submitted" | "waiting" | "result";
const COLS: Col[] = ["researching", "applied", "docs_submitted", "waiting", "result"];

interface AppCard {
  id: number; kind: string; ref_id: string | null; title: string;
  column: Col; notes: string; deadline: string | null; created_at: number; updated_at: number;
}

function KindBadge({ kind }: { kind: string }) {
  const t = useText("tracker_");
  return <Badge tone={kind === "college" ? "blue" : "green"}> {kind === "college" || kind === "scholarship" ? t(`kind_${kind}`) : kind}</Badge>;
}

function CardItem({ card, colIndex, totalCols, onMove, onEdit }: {
  card: AppCard; colIndex: number; totalCols: number;
  onMove: (id: number, dir: 1 | -1) => void;
  onEdit: (card: AppCard) => void;
}) {
  const t = useText("tracker_");
  return (
    <div draggable onDragStart={(e) => e.dataTransfer.setData("card_id", String(card.id))}
      className="rounded-xl bg-[var(--card)] p-3 shadow-sm ring-1 ring-[var(--border)] cursor-grab active:cursor-grabbing active:opacity-70">
      <div className="flex items-start justify-between gap-1">
        <span className="text-sm font-semibold leading-snug">{card.title}</span>
        <KindBadge kind={card.kind} />
      </div>
      {card.deadline && <p className="mt-1 text-[11px] text-[var(--muted)]">{card.deadline}</p>}
      {card.notes && <p className="mt-1 text-[11px] text-[var(--muted)] line-clamp-2">{card.notes}</p>}
      <div className="mt-2 flex items-center gap-1">
        {colIndex > 0 && <button onClick={() => onMove(card.id, -1)}
          className="rounded-lg bg-[var(--bg)] px-2 py-1 text-[11px]">{t("move_back")}</button>}
        {colIndex < totalCols - 1 && <button onClick={() => onMove(card.id, 1)}
          className="rounded-lg bg-[var(--brand)] px-2 py-1 text-[11px] text-white">{t("move")}</button>}
        <button onClick={() => onEdit(card)} aria-label={t("edit")} className="ml-auto rounded-lg bg-[var(--bg)] px-2 py-1 text-[11px]"><Icon name="pencil" size={14} /></button>
      </div>
    </div>
  );
}

function EditModal({ card, onClose, onSave, onDelete }: {
  card: AppCard; onClose: () => void; onSave: (patch: Partial<AppCard>) => void; onDelete: () => void;
}) {
  const t = useText("tracker_");
  const [notes, setNotes] = useState(card.notes);
  const [deadline, setDeadline] = useState(card.deadline ?? "");
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-2" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-[var(--card)] p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold">{card.title}</h3>
        <KindBadge kind={card.kind} />
        <label className="mt-3 block text-sm">
          <span className="text-[var(--muted)]">{t("notes")}</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            className="mt-1 w-full rounded-lg bg-[var(--bg)] p-2 text-sm" />
        </label>
        <label className="mt-2 block text-sm">
          <span className="text-[var(--muted)]">{t("deadline")}</span>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
            className="mt-1 w-full rounded-lg bg-[var(--bg)] p-2 text-sm" />
        </label>
        <div className="mt-3 flex gap-2">
          <button onClick={() => onSave({ notes, deadline: deadline || null })}
            className="flex-1 rounded-xl bg-[var(--brand)] py-2 text-sm font-semibold text-white">{t("save")}</button>
          <button onClick={onClose} className="flex-1 rounded-xl bg-[var(--bg)] py-2 text-sm">{t("cancel")}</button>
        </div>
        <button onClick={onDelete} className="mt-2 w-full text-xs text-rose-500">{t("delete")}</button>
      </div>
    </div>
  );
}

function AddForm({ onAdd }: { onAdd: (kind: string, title: string) => void }) {
  const t = useText("tracker_");
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("scholarship");
  const [title, setTitle] = useState("");
  if (!open) return <button onClick={() => setOpen(true)}
    className="w-full rounded-xl border-2 border-dashed border-[var(--border)] py-2 text-sm text-[var(--muted)]">+ {t("add")}</button>;
  return (
    <div className="rounded-xl bg-[var(--card)] p-3 ring-1 ring-[var(--border)]">
      <select value={kind} onChange={(e) => setKind(e.target.value)}
        className="mb-2 w-full rounded-lg bg-[var(--bg)] p-2 text-sm">
        <option value="scholarship">{t("scholarship")}</option>
        <option value="college">{t("college")}</option>
      </select>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("add_title")}
        className="w-full rounded-lg bg-[var(--bg)] p-2 text-sm" />
      <div className="mt-2 flex gap-2">
        <button onClick={() => { if (title.trim()) { onAdd(kind, title.trim()); setTitle(""); setOpen(false); } }}
          disabled={!title.trim()} className="flex-1 rounded-xl bg-[var(--brand)] py-2 text-sm font-semibold text-white disabled:opacity-50">{t("save")}</button>
        <button onClick={() => { setOpen(false); setTitle(""); }} className="flex-1 rounded-xl bg-[var(--bg)] py-2 text-sm">{t("cancel")}</button>
      </div>
    </div>
  );
}

function Board() {
  const { authFetch } = useApp();
  const t = useText("tracker_");
  const [cards, setCards] = useState<AppCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<AppCard | null>(null);
  const [seedMsg, setSeedMsg] = useState("");
  const [seeding, setSeeding] = useState(false);
  const dragOverCol = useRef<Col | null>(null);

  async function load() {
    setLoading(true); setErr("");
    const r = await authFetch("/api/tracker");
    if (!r.ok) { setErr(t("error")); setLoading(false); return; }
    setCards(await r.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function moveCard(id: number, dir: 1 | -1) {
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    const ci = COLS.indexOf(card.column);
    const next = COLS[ci + dir];
    if (!next) return;
    const r = await authFetch(`/api/tracker/${id}`, { method: "PATCH", body: JSON.stringify({ column: next }) });
    if (r.ok) setCards((cs) => cs.map((c) => c.id === id ? { ...c, column: next } : c));
  }

  async function addCard(kind: string, title: string) {
    const r = await authFetch("/api/tracker", { method: "POST", body: JSON.stringify({ kind, title }) });
    if (r.ok) r.json().then((card: AppCard) => setCards((cs) => [...cs, card]));
  }

  async function saveEdit(patch: Partial<AppCard>) {
    if (!editing) return;
    const r = await authFetch(`/api/tracker/${editing.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (r.ok) { const updated = await r.json(); setCards((cs) => cs.map((c) => c.id === updated.id ? updated : c)); }
    setEditing(null);
  }

  async function deleteCard() {
    if (!editing) return;
    const r = await authFetch(`/api/tracker/${editing.id}`, { method: "DELETE" });
    if (r.ok) setCards((cs) => cs.filter((c) => c.id !== editing.id));
    setEditing(null);
  }

  async function seed() {
    setSeeding(true); setSeedMsg("");
    const r = await authFetch("/api/tracker/seed", { method: "POST" });
    if (r.ok) {
      const j = await r.json();
      setSeedMsg(j.total === 0 ? t("seed_none") : t("seeded", { n: j.seeded }));
      await load();
    }
    setSeeding(false);
  }

  function onDrop(e: React.DragEvent, col: Col) {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("card_id"));
    if (!id) return;
    authFetch(`/api/tracker/${id}`, { method: "PATCH", body: JSON.stringify({ column: col }) }).then((r) => {
      if (r.ok) setCards((cs) => cs.map((c) => c.id === id ? { ...c, column: col } : c));
    });
  }

  if (loading) return <div className="py-16 text-center text-sm text-[var(--muted)]">{t("loading")}</div>;
  if (err) return <Card><p className="text-sm text-rose-500">{err}</p></Card>;

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 text-xs text-[var(--muted)]"><ProBadge />{t("title")}</div>
        <button onClick={seed} disabled={seeding}
          className="ml-auto rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 disabled:opacity-50 dark:bg-amber-900/30 dark:text-amber-200">
          {seeding ? t("seeding") : `${t("seed")}`}</button>
      </div>
      {seedMsg && <p className="text-xs text-[var(--good)]">{seedMsg}</p>}
      <details open={!cards.length} className="rounded-xl bg-[var(--card)] p-3 text-sm ring-1 ring-[var(--border)]">
        <summary className="cursor-pointer font-semibold">{t("how")}</summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px] leading-snug">
          <li>{t("how1")}</li>
          <li>{t("how2")}</li>
          <li>{t("how3")}</li>
        </ol>
      </details>
      <AddForm onAdd={addCard} />

      {/* the app is phone-width, so the five columns are stacked; cards still drag between them */}
      {!cards.length && <p className="rounded-xl bg-[var(--card)] p-4 text-center text-sm text-[var(--muted)] ring-1 ring-[var(--border)]">{t("empty")}</p>}
      <div className="space-y-3 pb-4">
        {COLS.map((col, ci) => {
          const colCards = cards.filter((c) => c.column === col);
          return (
            <section key={col} className="rounded-2xl bg-[var(--bg)] p-2.5 ring-1 ring-[var(--border)]"
              onDragOver={(e) => { e.preventDefault(); dragOverCol.current = col; }}
              onDrop={(e) => onDrop(e, col)}>
              <div className="mb-2 flex items-center gap-1.5">
                <span className="text-sm font-bold">{ci + 1}. {t(col)}</span>
                <span className="rounded-full bg-[var(--card)] px-2 py-0.5 text-[11px] font-semibold">{colCards.length}</span>
              </div>
              <div className="space-y-2">
                {colCards.length === 0 && <p className="rounded-xl border border-dashed border-[var(--border)] py-3 text-center text-[11px] text-[var(--muted)]">—</p>}
                {colCards.map((card) => (
                  <CardItem key={card.id} card={card} colIndex={ci} totalCols={COLS.length}
                    onMove={moveCard} onEdit={setEditing} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {editing && <EditModal card={editing} onClose={() => setEditing(null)} onSave={saveEdit} onDelete={deleteCard} />}
    </>
  );
}

export default function TrackerPage() {
  const t = useText("tracker_");
  return (
    <Shell title={t("title")}>
      <ProGate><Board /></ProGate>
    </Shell>
  );
}
