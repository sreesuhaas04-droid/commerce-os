"use client";

/**
 * The account console — sign in, create an account, manage API keys.
 *
 * Embedded in the showcase as its credentials act, and also served alone at
 * /login. This is the front door for the machine-buyer economy: an operator
 * signs in here and mints the scoped API key their buying agent presents to
 * /api/checkout. The key is displayed exactly once, on issuance, because the
 * server stores only a SHA-256 digest.
 *
 * Everything this console tells the user is true of the implementation: keys
 * are hashed at rest, passwords are scrypted, failed logins are audited, and
 * the checkout API refuses a buyerId that does not match the credential.
 *
 * `embedded` renders the section form (no page masthead, no back link) so the
 * showcase can drop it between two of its own acts without duplication.
 */

import { useCallback, useEffect, useState } from "react";

type Mode = "signin" | "signup";

interface AccountView {
  id: string; email: string; name: string; role: string;
}
interface KeyView {
  id: string; label: string; prefix: string; scopes: string[];
  createdAt: string; lastUsedAt: string | null; revokedAt: string | null;
}

export function AuthConsole({ embedded = false }: { embedded?: boolean }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [account, setAccount] = useState<AccountView | null>(null);

  // ── Sign in / create account state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"operator" | "buyer">("operator");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Key management state
  const [keys, setKeys] = useState<KeyView[]>([]);
  const [keyLabel, setKeyLabel] = useState("");
  const [issued, setIssued] = useState<{ secret: string; label: string } | null>(null);

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      const body = await res.json();
      setAccount(body.account ?? null);
      if (body.apiKeys) setKeys(body.apiKeys);
    } catch {
      /* offline — treated as signed out */
    }
  }, []);

  useEffect(() => {
    // Deferred past the render pass: the lint rule exists because synchronous
    // setState inside effects cascades; a microtask makes the intent explicit.
    queueMicrotask(() => void loadMe());
  }, [loadMe]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const res =
        mode === "signup"
          ? await fetch("/api/auth/signup", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, email, password, role }),
            })
          : await fetch("/api/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, password }),
            });
      const body = await res.json();
      if (!res.ok) { setError(body.error ?? "That did not work."); setBusy(false); return; }
      await loadMe();
      setPassword("");
    } catch {
      setError("The request failed — the server may be offline.");
    } finally {
      setBusy(false);
    }
  };

  const issueKey = async () => {
    if (keyLabel.trim().length < 3) { setError("Give the key a label (3+ characters)."); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/auth/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: keyLabel.trim(), scopes: ["catalog:read", "checkout:write"] }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error ?? "Key issue failed."); return; }
      setIssued({ secret: body.secret, label: body.key.label });
      setKeyLabel("");
      await loadMe();
    } finally {
      setBusy(false);
    }
  };

  const revokeKey = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/auth/keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadMe();
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAccount(null); setKeys([]); setIssued(null); setMode("signin");
  };

  return (
    <div
      className={
        embedded
          ? "mx-auto flex w-full max-w-3xl flex-col items-center gap-8"
          : "showcase mx-auto flex w-full max-w-2xl flex-col items-center gap-8 px-1 py-10 sm:px-2"
      }
    >
      {/* Masthead — page form only; the showcase supplies its own */}
      {!embedded && (
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="lg-pill">
          <span className="lg-led lg-led-pulse" />
          <span style={{ color: "var(--lg-lime)" }}>Account console</span>
        </span>
        <h1 className="text-[30px] font-semibold tracking-[-0.03em] sm:text-[36px]" style={{ fontFamily: "var(--lg-font-display)" }}>
          {account ? "Your agent credentials" : "Sign in to Commerce OS"}
        </h1>
        <p className="max-w-md text-[13px] leading-relaxed" style={{ color: "var(--lg-muted)" }}>
          {account
            ? "Issue scoped API keys for the AI buyers acting on your behalf. Keys are stored hashed — shown once, never again."
            : "Accounts gate the machine-buyer surface: checkout, carts and payments authenticate with a session or a scoped API key."}
        </p>
      </div>
      )}

      {error && (
        <div className="lg-panel w-full p-4 text-[12px]" style={{ borderColor: "rgba(244,63,94,0.4)", color: "#fda4af" }}>
          {error}
        </div>
      )}

      {/* ── Signed in: the key console ─────────────────────────────── */}
      {account ? (
        <div className="flex w-full flex-col gap-5">
          <div className="lg-panel flex items-center justify-between p-5">
            <div>
              <div className="text-[14px] font-medium">{account.name}</div>
              <div className="lg-label" style={{ color: "var(--lg-dim)" }}>
                {account.email} · {account.role} · {account.id}
              </div>
            </div>
            <button type="button" className="lg-btn-glass" onClick={signOut}>Sign out</button>
          </div>

          {/* The one-time secret */}
          {issued && (
            <div className="lg-panel-2 p-5" style={{ borderColor: "rgba(163,230,53,0.4)" }}>
              <div className="lg-label mb-2" style={{ color: "var(--lg-lime)" }}>
                {"// key issued — copy it now, it will never be shown again"}
              </div>
              <code
                className="block overflow-x-auto rounded-lg p-3 text-[12px]"
                style={{ background: "#0e0e10", color: "var(--lg-lime)", fontFamily: "var(--lg-font-mono)" }}
              >
                {issued.secret}
              </code>
              <button
                type="button"
                className="lg-btn-glass mt-3"
                onClick={() => navigator.clipboard?.writeText(issued.secret)}
              >
                Copy key
              </button>
            </div>
          )}

          {/* Issue a key */}
          <div className="lg-panel flex flex-col gap-3 p-5">
            <div className="lg-label" style={{ color: "var(--lg-muted)" }}>{"// issue an API key"}</div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                className="lg-input flex-1"
                placeholder="e.g. Perplexity shopping agent"
                value={keyLabel}
                onChange={(e) => setKeyLabel(e.target.value)}
                maxLength={60}
                aria-label="Key label"
              />
              <button type="button" className="lg-btn-primary" onClick={issueKey} disabled={busy}>
                {busy ? "Issuing…" : "Issue key"}
              </button>
            </div>
            <p className="text-[11px]" style={{ color: "var(--lg-dim)" }}>
              Scopes granted: <span style={{ color: "var(--lg-lime)" }}>catalog:read</span>,{" "}
              <span style={{ color: "var(--lg-lime)" }}>checkout:write</span> — the buyer can read the
              catalog and transact, nothing else.
            </p>
          </div>

          {/* Existing keys */}
          <div className="lg-panel flex flex-col gap-3 p-5">
            <div className="lg-label" style={{ color: "var(--lg-muted)" }}>
              {`// your keys (${keys.filter((k) => !k.revokedAt).length} active)`}
            </div>
            {keys.length === 0 ? (
              <div className="text-[12px]" style={{ color: "var(--lg-dim)" }}>No keys yet.</div>
            ) : (
              <ul className="flex flex-col gap-2">
                {keys.map((key) => (
                  <li
                    key={key.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    style={{ borderColor: key.revokedAt ? "rgba(244,63,94,0.3)" : "var(--lg-line)" }}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium">{key.label}</div>
                      <div className="lg-label" style={{ color: "var(--lg-dim)" }}>
                        {key.prefix}… · {key.scopes.join(", ")} ·{" "}
                        {key.revokedAt ? "revoked" : key.lastUsedAt ? "used recently" : "never used"}
                      </div>
                    </div>
                    {!key.revokedAt && (
                      <button
                        type="button"
                        className="lg-btn-glass"
                        style={{ borderColor: "rgba(244,63,94,0.4)", color: "#fda4af" }}
                        onClick={() => revokeKey(key.id)}
                        disabled={busy}
                      >
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="lg-well p-5 text-[11px] leading-relaxed" style={{ color: "var(--lg-muted)" }}>
            <span className="lg-label" style={{ color: "var(--lg-lime)" }}>{"// use it"}</span>
            <pre className="lg-code mt-2">{`curl -X POST https://your-host/api/checkout \\
  -H "Authorization: Bearer sk_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{"intent":"cart","productIds":["prd_002"]}'`}</pre>
          </div>
        </div>
      ) : (
      /* ── Signed out: the auth card ─────────────────────────────── */
        <div className="flex w-full flex-col gap-3">
          <div className="flex gap-2">
            <button type="button" className="lg-tab" data-active={mode === "signin"} onClick={() => { setMode("signin"); setError(null); }}>
              Sign in
            </button>
            <button type="button" className="lg-tab" data-active={mode === "signup"} onClick={() => { setMode("signup"); setError(null); }}>
              Create account
            </button>
          </div>

          <form onSubmit={submit} className="lg-panel flex flex-col gap-4 p-6">
            {mode === "signup" && (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className="lg-label" style={{ color: "var(--lg-muted)" }}>Name</span>
                  <input
                    className="lg-input" value={name} required minLength={2} maxLength={80}
                    onChange={(e) => setName(e.target.value)} autoComplete="name"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="lg-label" style={{ color: "var(--lg-muted)" }}>I am…</span>
                  <div className="flex gap-2">
                    {(["operator", "buyer"] as const).map((r) => (
                      <button
                        key={r} type="button" className="lg-tab" data-active={role === r}
                        onClick={() => setRole(r)}
                      >
                        {r === "operator" ? "An operator" : "An AI buyer"}
                      </button>
                    ))}
                  </div>
                </label>
              </>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="lg-label" style={{ color: "var(--lg-muted)" }}>Email</span>
              <input
                className="lg-input" type="email" value={email} required maxLength={120}
                onChange={(e) => setEmail(e.target.value)} autoComplete="email"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="lg-label" style={{ color: "var(--lg-muted)" }}>Password</span>
              <input
                className="lg-input" type="password" value={password} required
                minLength={mode === "signup" ? 8 : 1} maxLength={200}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
              {mode === "signup" && (
                <span className="text-[11px]" style={{ color: "var(--lg-dim)" }}>
                  8+ characters, at least one letter and one number. Stored as a scrypt hash with a per-account salt.
                </span>
              )}
            </label>

            <button type="submit" className="lg-btn-primary" disabled={busy}>
              {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
            </button>

            <p className="text-[11px] leading-relaxed" style={{ color: "var(--lg-dim)" }}>
              Failed attempts are rate-limited and audited. Sessions are opaque tokens
              revocable at sign-out. Neither this form nor any API ever returns your password.
            </p>
          </form>
        </div>
      )}
    </div>
  );
}
