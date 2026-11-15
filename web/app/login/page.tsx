"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Card, Shell } from "@/components/ui";
import { API, useApp, type AuthUser } from "@/lib/store";

function LoginForm() {
  const { t, signIn } = useApp();
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/";
  const [role, setRole] = useState<"student" | "teacher">(sp.get("role") === "teacher" ? "teacher" : "student");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const sendOtp = async () => {
    const j = await call("/api/auth/otp/request", { phone, role });
    if (j) { setStep("otp"); setHint(j.sandbox_hint); }
  };
  const verify = async () => {
    const j = await call("/api/auth/otp/verify", { phone, role, code, name: name || null });
    if (j) {
      await signIn(j.access_token, j.user as AuthUser);
      router.replace(next);
    }
  };

  return (
    <Card className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {(["student", "teacher"] as const).map((r) => (
          <button key={r} onClick={() => { setRole(r); setStep("phone"); }}
            className={`rounded-xl py-3 font-semibold ${role === r ? "bg-[var(--brand)] text-white" : "bg-[var(--bg)]"}`}>
            {r === "student" ? "🎒" : "👩‍🏫"} {t(r === "student" ? "role_student" : "role_teacher")}
          </button>
        ))}
      </div>

      {step === "phone" ? (
        <>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">{t("phone")}</span>
            <div className="mt-1 flex items-center rounded-xl bg-[var(--bg)] px-3">
              <span className="text-[var(--muted)]">+91</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" autoComplete="tel"
                className="w-full bg-transparent p-3 text-lg tracking-wider outline-none" placeholder="98XXXXXXXX" />
            </div>
          </label>
          {role === "student" && (
            <label className="block text-sm">
              <span className="text-[var(--muted)]">{t("your_name")}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl bg-[var(--bg)] p-3" />
            </label>
          )}
          <button onClick={sendOtp} disabled={busy || phone.length !== 10} className="w-full rounded-xl bg-[var(--accent)] py-3 font-semibold text-white disabled:opacity-40">{t("send_otp")}</button>
        </>
      ) : (
        <>
          <p className="text-sm">{t("otp_sent", { phone: `+91 ${phone}` })} · <button className="underline" onClick={() => { setStep("phone"); setCode(""); }}>{t("change_number")}</button></p>
          {hint && <p className="rounded-lg bg-[var(--brand-soft)] p-2 text-sm text-[var(--brand-ink)]">🔐 {hint}</p>}
          <label className="block text-sm">
            <span className="text-[var(--muted)]">{t("enter_otp")}</span>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code"
              className="mt-1 w-full rounded-xl bg-[var(--bg)] p-3 text-center text-2xl tracking-[0.5em]" />
          </label>
          <button onClick={verify} disabled={busy || code.length !== 6} className="w-full rounded-xl bg-[var(--brand)] py-3 font-semibold text-white disabled:opacity-40">{t("verify_login")}</button>
        </>
      )}
      {error && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{error}</p>}
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
