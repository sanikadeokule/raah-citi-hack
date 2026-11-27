"use client";
import { Icon } from "@/components/icon";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { Card, Shell } from "@/components/ui";
import { API, useApp, type AuthUser } from "@/lib/store";

type Mode = "signin" | "register";

function LoginForm() {
  const { t, signIn, auth, authReady } = useApp();
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/";
  // someone who is already signed in has nothing to do here (the Google callback carries a token and signs in below)
  useEffect(() => { if (authReady && auth && !sp.get("token")) router.replace(next); }, [authReady, auth, sp, next, router]);
  const [role, setRole] = useState<"student" | "teacher">(sp.get("role") === "teacher" ? "teacher" : "student");
  const [mode, setMode] = useState<Mode>(sp.get("mode") === "register" && sp.get("role") === "teacher" ? "register" : "signin");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Handle Google OAuth callback: /login?token=...
  useState(() => {
    const token = sp.get("token");
    const oauthError = sp.get("error");
    if (oauthError) { setError(t("login_google_error_detail", { error: oauthError })); return; }
    if (token) {
      (async () => {
        try {
          // fetch the user profile with the returned token
          const r = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
          if (r.ok) {
            const user = await r.json();
            await signIn(token, user as AuthUser);
            router.replace(next);
          } else {
            setError(t("login_google_error"));
          }
        } catch { setError(t("login_google_error")); }
      })();
    }
  });

  const switchMode = (m: Mode) => { setMode(m); setError(null); setNotice(null); setPin(""); setPin2(""); };

  const call = async (path: string, body: object) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : j.detail?.[0]?.msg?.replace("Value error, ", "") ?? "Error");
      return j;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally { setBusy(false); }
  };

  const register = async () => {
    if (pin !== pin2) { setError(t("pin_mismatch")); return; }
    const j = await call("/api/auth/register", { name, phone, pin, role });
    if (j) {
      // registration done: move to sign in with the number filled in
      setMode("signin"); setPin(""); setPin2("");
      setNotice(t("registered_sign_in", { name: j.user.name }));
    }
  };
  const login = async () => {
    const j = await call("/api/auth/login", { phone, pin, role });
    if (j) {
      await signIn(j.access_token, j.user as AuthUser);
      router.replace(next);
    }
  };

  const pinInput = (value: string, set: (v: string) => void, label: string, auto: string) => (
    <label className="block text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <input value={value} onChange={(e) => set(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" type="password"
        autoComplete={auto} className="mt-1 w-full rounded-xl bg-[var(--bg)] p-3 text-center text-2xl tracking-[0.5em]" />
    </label>
  );
  const pinOk = pin.length >= 4;
  const canSubmit = phone.length === 10 && pinOk && (mode === "signin" || (name.trim().length >= 2 && pin2.length >= 4));

  return (
    <Card className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {(["student", "teacher"] as const).map((r) => (
          <button key={r} onClick={() => { setRole(r); if (r === "student") setMode("signin"); setError(null); }}
            className={`rounded-xl py-3 font-semibold ${role === r ? "bg-[var(--brand)] text-white" : "bg-[var(--bg)]"}`}>
            {r === "student" ? "" : ""} {t(r === "student" ? "role_student" : "role_teacher")}
          </button>
        ))}
      </div>

      {role === "teacher" && <div className="grid grid-cols-2 gap-1 rounded-xl bg-[var(--bg)] p-1">
        {(["register", "signin"] as const).map((m) => (
          <button key={m} onClick={() => switchMode(m)}
            className={`rounded-lg py-2 font-semibold ${mode === m ? "bg-[var(--card)] text-[var(--brand-ink)] shadow-sm" : "text-[var(--muted)]"}`}>
            {m === "register" ? `${t("register")}` : `${t("sign_in")}`}
          </button>
        ))}
      </div>}

      {notice && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">{notice}</p>}

      {mode === "register" && (
        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("full_name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60}
            className="mt-1 w-full rounded-xl bg-[var(--bg)] p-3 text-lg" />
        </label>
      )}
      <label className="block text-sm">
        <span className="text-[var(--muted)]">{t("phone")}</span>
        <div className="mt-1 flex items-center rounded-xl bg-[var(--bg)] px-3">
          <span className="text-[var(--muted)]">+91</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" autoComplete="tel"
            className="w-full bg-transparent p-3 text-lg tracking-wider outline-none" placeholder="98XXXXXXXX" />
        </div>
      </label>
      {pinInput(pin, setPin, t("pin"), mode === "register" ? "new-password" : "current-password")}
      {mode === "register" && pinInput(pin2, setPin2, t("pin_again"), "new-password")}
      {mode === "register" && <p className="text-xs text-[var(--muted)]">{t("pin_hint")}</p>}
      {mode === "register" && role === "teacher" && <p className="text-xs text-[var(--muted)]">{t("teacher_register_note")}</p>}

      <button onClick={mode === "register" ? register : login} disabled={busy || !canSubmit}
        className="w-full rounded-xl bg-[var(--brand)] py-3 text-lg font-semibold text-white disabled:opacity-40">
        {mode === "register" ? t("create_account") : t("sign_in")}
      </button>

      <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
        <hr className="flex-1 border-[var(--muted)]/30" />{t("login_or")}<hr className="flex-1 border-[var(--muted)]/30" />
      </div>

      <button type="button" onClick={() => { window.location.assign(`${API}/api/auth/google?role=${role}`); }}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--muted)]/30 bg-white py-3 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 29.9 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/>
          <path fill="#34A853" d="M6.3 14.7l7 5.1C15 16.1 19.1 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2c-7.6 0-14.2 4.1-17.7 10.2z" transform="translate(0,1)"/>
          <path fill="#FBBC05" d="M24 46c5.9 0 10.9-1.9 14.5-5.2l-6.7-5.5C29.7 37 27 38 24 38c-5.9 0-10.9-3.6-13.2-8.8l-7 5.4C7.9 41.7 15.3 46 24 46z" transform="translate(0,-1)"/>
          <path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-.8 2.5-2.4 4.6-4.5 6l6.7 5.5C42 36.5 45 31.1 45 24c0-1.3-.2-2.7-.5-4z" transform="translate(-0.5,0)"/>
        </svg>
        {t("login_google")}
      </button>

      {error && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{error}</p>}

      <p className="text-center text-sm">
        {role === "student"
          ? <>{t("new_here")} <Link href="/start/" className="font-semibold underline">{t("start_get_started")}</Link></>
          : mode === "signin"
          ? <>{t("new_here")} <button className="font-semibold underline" onClick={() => switchMode("register")}>{t("register")}</button></>
          : <>{t("have_account")} <button className="font-semibold underline" onClick={() => switchMode("signin")}>{t("sign_in")}</button></>}
      </p>
      {mode === "signin" && <p className="text-center text-xs text-[var(--muted)]">{t("forgot_pin")}</p>}
    </Card>
  );
}

export default function LoginPage() {
  const { t } = useApp();
  return (
    <Shell title={t("login_title")} back={null} publicPage>
      <div className="py-4 text-center">
        <Icon name="compass" size={52} className="text-[var(--brand)]" />
        <h2 className="mt-2 text-2xl font-bold text-[var(--brand-ink)]">{t("app_name")}</h2>
        <p className="text-sm text-[var(--muted)]">{t("tagline")}</p>
      </div>
      <Suspense><LoginForm /></Suspense>
    </Shell>
  );
}
