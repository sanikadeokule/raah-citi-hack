"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Card, Shell } from "@/components/ui";
import { API, useApp, type AuthUser } from "@/lib/store";

type Mode = "signin" | "register";

function LoginForm() {
  const { t, signIn } = useApp();
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/";
  const [role, setRole] = useState<"student" | "teacher">(sp.get("role") === "teacher" ? "teacher" : "student");
  const [mode, setMode] = useState<Mode>(sp.get("mode") === "register" ? "register" : "signin");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
          <button key={r} onClick={() => { setRole(r); setError(null); }}
            className={`rounded-xl py-3 font-semibold ${role === r ? "bg-[var(--brand)] text-white" : "bg-[var(--bg)]"}`}>
            {r === "student" ? "🎒" : "👩‍🏫"} {t(r === "student" ? "role_student" : "role_teacher")}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-[var(--bg)] p-1">
        {(["register", "signin"] as const).map((m) => (
          <button key={m} onClick={() => switchMode(m)}
            className={`rounded-lg py-2 font-semibold ${mode === m ? "bg-[var(--card)] text-[var(--brand-ink)] shadow-sm" : "text-[var(--muted)]"}`}>
            {m === "register" ? `📝 ${t("register")}` : `🔑 ${t("sign_in")}`}
          </button>
        ))}
      </div>

      {notice && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">✅ {notice}</p>}

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
      {mode === "register" && <p className="text-xs text-[var(--muted)]">🔒 {t("pin_hint")}</p>}
      {mode === "register" && role === "teacher" && <p className="text-xs text-[var(--muted)]">{t("teacher_register_note")}</p>}

      <button onClick={mode === "register" ? register : login} disabled={busy || !canSubmit}
        className="w-full rounded-xl bg-[var(--brand)] py-3 text-lg font-semibold text-white disabled:opacity-40">
        {mode === "register" ? t("create_account") : t("sign_in")}
      </button>

      {error && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{error}</p>}

      <p className="text-center text-sm">
        {mode === "signin"
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
        <div className="text-5xl">🧭</div>
        <h2 className="mt-2 text-2xl font-bold text-[var(--brand-ink)]">{t("app_name")}</h2>
        <p className="text-sm text-[var(--muted)]">{t("tagline")}</p>
      </div>
      <Suspense><LoginForm /></Suspense>
    </Shell>
  );
}
