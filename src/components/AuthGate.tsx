import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { supabase } from "../lib/supabase";

export function AuthGate() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "sign-in") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setNotice("Account created. Confirm the email address, then sign in.");
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 8h12" stroke="#ffb400" strokeWidth="1.4"/>
              <path d="M4 5.5v5M8 5.5v5M12 5.5v5" stroke="#f2f2f2" strokeWidth="1.4"/>
            </svg>
          </div>
          <div><strong>SUTURE</strong><small>COMPLIANCE CONTINUITY</small></div>
        </div>
        <div className="eyebrow"><ShieldCheck size={13} /> ISSUER WORKSPACE ACCESS</div>
        <h1>{mode === "sign-in" ? "Sign in to your workspace" : "Create an operator account"}</h1>
        <p className="auth-sub">
          Authentication is required before any organization data is read. Wallet connection is
          not authentication.
        </p>

        <label className="form-field">
          <span>Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>Password</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error && <div className="form-error" role="alert">{error}</div>}
        {notice && <div className="form-notice" role="status">{notice}</div>}

        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setError(null); setNotice(null); }}
        >
          {mode === "sign-in" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
