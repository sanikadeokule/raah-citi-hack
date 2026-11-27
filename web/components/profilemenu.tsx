"use client";
// The avatar in the app bar opens this menu. Signing out is one item inside it, never the avatar itself:
// on a phone there is no hover tooltip, so a tap on the avatar must not end the session.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { ROADMAP_HREF } from "@/lib/roadmap";
import { useApp } from "@/lib/store";

type Theme = "system" | "light" | "dark";
const THEME_KEY = "raah-theme";

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch { return "system"; }
}

function applyTheme(v: Theme) {
  const root = document.documentElement;
  if (v === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", v);
}

const SHORTCUTS = [
  { key: "menu_my_roadmap", href: ROADMAP_HREF, icon: "map" },
  { key: "menu_my_progress", href: "/progress/", icon: "chart" },
  { key: "menu_my_mentor", href: "/opportunity/?tab=mentors", icon: "users" },
  { key: "menu_apply", href: "/apply/", icon: "clipboard" },
  { key: "menu_parent", href: "/parent/", icon: "users" },
];

export function ProfileMenu() {
  const { t, auth, signOut } = useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showThemes, setShowThemes] = useState(false);
  const [theme, setTheme] = useState<Theme>("system");
  const box = useRef<HTMLDivElement>(null);

  // the saved appearance applies on every page, whether or not the menu is opened
  useEffect(() => { const v = readTheme(); setTheme(v); applyTheme(v); }, []);

  useEffect(() => {
    if (!open) { setShowThemes(false); return; }
    const outside = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (!auth) return null;
  const name = auth.user.name || auth.user.phone || auth.user.role;
  const initial = (auth.user.name || auth.user.role)[0].toUpperCase();

  const pickTheme = (v: Theme) => {
    setTheme(v);
    applyTheme(v);
    try { if (v === "system") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, v); } catch { /* still applied for this visit */ }
  };
  const close = () => setOpen(false);

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={t("profile_menu")}
        className={`grid h-8 w-8 place-items-center rounded-full text-sm font-bold active:scale-90 ${open ? "bg-white/30 ring-2 ring-[var(--saffron)]" : "bg-white/15"}`}>
        {initial}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-40 w-72 max-w-[calc(100vw-2rem)] rounded-2xl bg-[var(--card)] p-3 text-[var(--ink)] shadow-xl ring-1 ring-black/10">
          <Link href="/profile/" onClick={close} role="menuitem" className="flex items-center gap-3 rounded-xl p-1">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-lg font-bold text-white">{initial}</span>
            <span className="min-w-0">
              <span className="block truncate font-bold">{name}</span>
              <span className="block text-sm font-medium text-[var(--accent)]">{auth.user.is_pro ? "Raah Pro" : t("try_premium")}</span>
            </span>
          </Link>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {SHORTCUTS.map((s) => (
              <Link key={s.key} href={s.href} onClick={close} role="menuitem"
                className="flex flex-col items-center gap-1 rounded-xl bg-[var(--bg)] px-1 py-3 text-center text-xs font-medium active:scale-95">
                <Icon name={s.icon} size={22} className="text-[var(--brand)]" />
                {t(s.key)}
              </Link>
            ))}
          </div>

          <div className="my-3 h-px bg-[var(--muted)] opacity-25" />

          <Link href="/profile/" onClick={close} role="menuitem" className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-sm hover:bg-[var(--bg)]">
            <Icon name="settings" size={18} />{t("settings")}
          </Link>
          <button type="button" role="menuitem" aria-expanded={showThemes} onClick={() => setShowThemes((s) => !s)}
            className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left text-sm hover:bg-[var(--bg)]">
            <Icon name="moon" size={18} />
            <span className="flex-1">{t("appearance")}</span>
            <span aria-hidden className={`text-[var(--muted)] transition-transform ${showThemes ? "rotate-90" : ""}`}>›</span>
          </button>
          {showThemes && (
            <div className="mb-1 ml-10 flex flex-col">
              {(["system", "light", "dark"] as Theme[]).map((v) => (
                <button key={v} type="button" role="menuitemradio" aria-checked={theme === v} onClick={() => pickTheme(v)}
                  className="flex items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-[var(--bg)]">
                  {t(`theme_${v}`)}{theme === v && <Icon name="check" size={16} className="text-[var(--brand)]" />}
                </button>
              ))}
            </div>
          )}
          <button type="button" role="menuitem" onClick={async () => { close(); await signOut(); router.replace("/login/"); }}
            className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left text-sm text-[var(--bad)] hover:bg-[var(--bg)]">
            <Icon name="logout" size={18} />{t("logout")}
          </button>
        </div>
      )}
    </div>
  );
}
