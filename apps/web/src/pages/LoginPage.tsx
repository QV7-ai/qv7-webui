import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import type { PublicBranding } from "@wlfv/shared";
import { DEFAULT_LOGO } from "@/lib/branding";
import { useT } from "@/lib/language";

export default function LoginPage({ branding }: { branding: PublicBranding }) {
  const tr = useT();
  const name = branding.name || "QV7";
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [signupsEnabled, setSignupsEnabled] = useState(false);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api
      .get("/api/auth/public")
      .then((data) => setSignupsEnabled(Boolean(data.signupsEnabled)))
      .catch(() => undefined);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      if (mode === "signup") {
        await api.send("/api/auth/register", "POST", { email, password, username });
      } else {
        await api.send("/api/auth/login", "POST", { email, password });
      }
      location.assign("/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === "signup" ? tr("signupError") : tr("loginError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-[var(--bg)] px-6 py-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <form onSubmit={onSubmit} className="w-full max-w-sm">
        <img
          src={branding.splashUrl || branding.logoUrl || DEFAULT_LOGO}
          alt=""
          className="mx-auto mb-4 max-h-20 max-w-[180px] object-contain"
        />
        <p className="text-center text-[13px] tracking-[0.14em] text-[var(--muted)]">{name}</p>
        {branding.description ? <p className="mt-1 text-center text-[13px] text-[var(--secondary)]">{branding.description}</p> : null}
        <h1 className="mt-3 text-center text-[24px] font-medium">{mode === "signup" ? tr("createAccount") : tr("welcomeBack")}</h1>
        <label className="mt-8 block text-[12px] text-[var(--muted)]">
          {tr("email")}
          <input
            className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-3 text-[14px] outline-none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
          />
        </label>
        {mode === "signup" ? (
          <label className="mt-4 block text-[12px] text-[var(--muted)]">
            {tr("accountUsername")}
            <input
              className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-3 text-[14px] outline-none"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={tr("optional")}
              autoComplete="nickname"
            />
          </label>
        ) : null}
        <label className="mt-4 block text-[12px] text-[var(--muted)]">
          {tr("password")}
          <input
            type="password"
            className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-3 text-[14px] outline-none"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
        </label>
        {error ? <p className="mt-3 text-[13px] text-[var(--danger)]">{error}</p> : null}
        <Button type="submit" variant="primary" className="mt-6 w-full" disabled={pending}>
          {pending ? tr("pleaseWait") : mode === "signup" ? tr("createAccountBtn") : tr("signIn")}
        </Button>
        {signupsEnabled ? (
          <button
            type="button"
            className="mt-4 w-full text-center text-[13px] text-[var(--muted)] hover:text-[var(--text)]"
            onClick={() => {
              setMode((current) => (current === "login" ? "signup" : "login"));
              setError("");
            }}
          >
            {mode === "signup" ? tr("alreadyAccount") : tr("needAccount")}
          </button>
        ) : null}
      </form>
      {branding.footer ? <p className="mt-8 text-center text-[12px] text-[var(--muted)]">{branding.footer}</p> : null}
    </div>
  );
}
