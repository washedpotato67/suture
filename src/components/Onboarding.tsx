import { useState, type FormEvent } from "react";
import { Building2 } from "lucide-react";
import { createOrganization } from "../lib/data";

export function Onboarding({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createOrganization(name, slug);
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Organization setup failed");
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div className="eyebrow"><Building2 size={13} /> FIRST ORGANIZATION</div>
        <h1>Set up your issuer workspace</h1>
        <p className="auth-sub">
          This creates your organization and loads the deterministic Northstar Capital demo
          scenario — one regulated note, its derived positions, and an open revocation incident.
          Demo rows are labeled and never claim live provider calls.
        </p>

        <label className="form-field">
          <span>Organization name</span>
          <input
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Northstar Capital"
          />
        </label>
        <label className="form-field">
          <span>Slug</span>
          <input
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="Lowercase letters, numbers, and hyphens"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="northstar-capital"
          />
        </label>

        {error && <div className="form-error" role="alert">{error}</div>}

        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Creating workspace…" : "Create workspace with demo data"}
        </button>
      </form>
    </div>
  );
}
