/**
 * Accounts, sessions and API keys.
 *
 * The console previously had one shared DEMO_PASSWORD and no accounts at all,
 * which the security review listed as an accepted risk. This module replaces
 * that for the money APIs: real accounts with scrypt-hashed passwords,
 * opaque session tokens, and scoped API keys for AI buyers.
 *
 * Design rules, matching the rest of the system:
 *   - Passwords: scrypt with a per-account random salt. Never stored, never
 *     logged, never returned by any route.
 *   - Sessions: 256 bits of entropy in a cookie (httpOnly, SameSite=Lax).
 *     A session token is not the password, so leaking the cookie leaks a
 *     revocable handle, not the credential itself.
 *   - API keys: `sk_live_`-shaped but scoped to this deployment's surface and
 *     hashed at rest with SHA-256. The plaintext appears exactly once, in the
 *     creating response. A buyer presenting a key is a first-class principal.
 *   - Every auth event — signup, login, logout, key issue, key use, key
 *     revoke, failed login — lands in the audit log the whole console reads.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getDb, str } from "@/database/db";
import { writeAudit } from "@/database/queries";
import { newId } from "@/lib/ids";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Account {
  id: string;
  email: string;
  name: string;
  role: "operator" | "buyer";
  createdAt: string;
  lastLoginAt: string | null;
}

export interface ApiKeyRecord {
  id: string;
  accountId: string;
  label: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface AuthenticatedRequest {
  account: Account;
  /** How the caller proved identity: "session" (cookie) or "api_key" (bearer). */
  via: "session" | "api_key";
  /** Present when via = "api_key". */
  apiKey?: ApiKeyRecord;
}

export const SESSION_COOKIE = "commerce_os_session";
const SESSION_TTL_DAYS = 7;

/** Scopes an API key may hold. Machine buyers need checkout + catalog. */
export const API_KEY_SCOPES = ["catalog:read", "checkout:write"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

// ─── Passwords ────────────────────────────────────────────────────────────────

/** scrypt hash, stored as `salt$hash` — both hex. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}$${hash.toString("hex")}`;
}

/**
 * Constant-time verification. A wrong password costs the same as a right one,
 * so an attacker cannot distinguish "nearly right" from "wrong".
 */
export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split("$");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** The minimum bar a password must clear. Called at the route boundary too. */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 8) problems.push("at least 8 characters");
  if (!/[a-zA-Z]/.test(password)) problems.push("one letter");
  if (!/[0-9]/.test(password)) problems.push("one number");
  return problems;
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

export function createAccount(input: {
  email: string;
  name: string;
  password: string;
  role: "operator" | "buyer";
}): Account {
  const db = getDb();
  const account: Account = {
    id: newId("acc"),
    email: input.email.toLowerCase(),
    name: input.name,
    role: input.role,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  };
  db.run(
    `INSERT INTO accounts (id, email, name, role, password_hash, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    account.id,
    account.email,
    account.name,
    account.role,
    hashPassword(input.password),
    account.createdAt,
  );
  writeAudit({
    agentId: "system",
    action: "account:signup",
    entityType: "account",
    entityId: account.id,
    input: { email: account.email, role: account.role },
    output: null,
    policyResult: "ALLOW",
    approvalRequired: false,
    approvalStatus: null,
    risk: "LOW",
    executionStatus: "COMPLETED",
    correlationId: newId("cor"),
  });
  return account;
}

export function getAccountByEmail(email: string): { account: Account; passwordHash: string } | null {
  const row = getDb().get(
    `SELECT * FROM accounts WHERE email = ?`,
    email.toLowerCase(),
  );
  if (!row) return null;
  return {
    account: {
      id: str(row.id),
      email: str(row.email),
      name: str(row.name),
      role: str(row.role) === "buyer" ? "buyer" : "operator",
      createdAt: str(row.created_at),
      lastLoginAt: row.last_login_at ? str(row.last_login_at) : null,
    },
    passwordHash: str(row.password_hash),
  };
}

export function getAccount(id: string): Account | null {
  const row = getDb().get(`SELECT * FROM accounts WHERE id = ?`, id);
  if (!row) return null;
  return {
    id: str(row.id),
    email: str(row.email),
    name: str(row.name),
    role: str(row.role) === "buyer" ? "buyer" : "operator",
    createdAt: str(row.created_at),
    lastLoginAt: row.last_login_at ? str(row.last_login_at) : null,
  };
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

/** Creates a session row and returns the opaque token to set as a cookie. */
export function createSession(accountId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  getDb().run(
    `INSERT INTO sessions (id, account_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
    token,
    accountId,
    now.toISOString(),
    expires.toISOString(),
    now.toISOString(),
  );
  return { token, expiresAt: expires.toISOString() };
}

export function deleteSession(token: string): void {
  getDb().run(`DELETE FROM sessions WHERE id = ?`, token);
}

/** Resolves a session token to its account, if unexpired. Updates last_seen. */
export function accountForSession(token: string): Account | null {
  const row = getDb().get(`SELECT * FROM sessions WHERE id = ?`, token);
  if (!row) return null;
  const expiresAt = str(row.expires_at);
  if (new Date(expiresAt).getTime() < Date.now()) {
    getDb().run(`DELETE FROM sessions WHERE id = ?`, token);
    return null;
  }
  const account = getAccount(str(row.account_id));
  if (account) {
    getDb().run(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`, new Date().toISOString(), token);
  }
  return account;
}

// ─── API keys ─────────────────────────────────────────────────────────────────

const keyDigest = (plaintext: string): string =>
  createHash("sha256").update(plaintext).digest("hex");

/**
 * Issues a key and returns the plaintext exactly once. The stored row carries
 * only the digest and a display prefix; there is no way back to the key.
 */
export function issueApiKey(input: {
  accountId: string;
  label: string;
  scopes: ApiKeyScope[];
}): { record: ApiKeyRecord; plaintext: string } {
  const db = getDb();
  const id = newId("key");
  const random = randomBytes(24).toString("base64url");
  const plaintext = `sk_live_${random}`;
  const record: ApiKeyRecord = {
    id,
    accountId: input.accountId,
    label: input.label,
    prefix: plaintext.slice(0, 12),
    scopes: input.scopes,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };
  db.run(
    `INSERT INTO api_keys (id, account_id, label, key_hash, prefix, scopes, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    record.id,
    record.accountId,
    record.label,
    keyDigest(plaintext),
    record.prefix,
    JSON.stringify(record.scopes),
    record.createdAt,
  );
  writeAudit({
    agentId: "system",
    action: "api_key:issued",
    entityType: "api_key",
    entityId: id,
    input: { accountId: input.accountId, label: input.label, scopes: input.scopes },
    output: { prefix: record.prefix },
    policyResult: "ALLOW",
    approvalRequired: false,
    approvalStatus: null,
    risk: "LOW",
    executionStatus: "COMPLETED",
    correlationId: newId("cor"),
  });
  return { record, plaintext };
}

/** Resolves a bearer key to its record and account, if live. Marks last_used. */
export function resolveApiKey(bearer: string): { key: ApiKeyRecord; account: Account } | null {
  const row = getDb().get(`SELECT * FROM api_keys WHERE key_hash = ?`, keyDigest(bearer));
  if (!row) return null;
  if (row.revoked_at) return null;
  const account = getAccount(str(row.account_id));
  if (!account) return null;
  const key: ApiKeyRecord = {
    id: str(row.id),
    accountId: account.id,
    label: str(row.label),
    prefix: str(row.prefix),
    scopes: JSON.parse(str(row.scopes)) as string[],
    createdAt: str(row.created_at),
    lastUsedAt: row.last_used_at ? str(row.last_used_at) : null,
    revokedAt: null,
  };
  getDb().run(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`, new Date().toISOString(), key.id);
  return { key, account };
}

export function revokeApiKey(accountId: string, keyId: string): boolean {
  const changed = getDb().run(
    `UPDATE api_keys SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL`,
    new Date().toISOString(),
    keyId,
    accountId,
  );
  if (changed.changes > 0) {
    writeAudit({
      agentId: "system",
      action: "api_key:revoked",
      entityType: "api_key",
      entityId: keyId,
      input: { accountId },
      output: null,
      policyResult: "ALLOW",
      approvalRequired: false,
      approvalStatus: null,
      risk: "LOW",
      executionStatus: "COMPLETED",
      correlationId: newId("cor"),
    });
  }
  return changed.changes > 0;
}

/** The account's keys, plaintext never included. */
export function listApiKeys(accountId: string): ApiKeyRecord[] {
  return getDb()
    .all(`SELECT * FROM api_keys WHERE account_id = ? ORDER BY created_at DESC`, accountId)
    .map((row) => ({
      id: str(row.id),
      accountId,
      label: str(row.label),
      prefix: str(row.prefix),
      scopes: JSON.parse(str(row.scopes)) as string[],
      createdAt: str(row.created_at),
      lastUsedAt: row.last_used_at ? str(row.last_used_at) : null,
      revokedAt: row.revoked_at ? str(row.revoked_at) : null,
    }));
}

// ─── Route guard ──────────────────────────────────────────────────────────────

/**
 * Authenticates a request via session cookie or Bearer API key.
 *
 * Returns null with a 401-shaped reason when unauthenticated — the caller
 * turns that into a response; this function never throws for bad credentials,
 * because a wrong key is a normal event, not an exception.
 */
export function authenticate(request: Request): AuthenticatedRequest | null {
  // 1 — Bearer API key (the machine-buyer path).
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, value] = authorization.split(" ");
  if (scheme === "Bearer" && value) {
    const resolved = resolveApiKey(value);
    if (resolved) return { account: resolved.account, via: "api_key", apiKey: resolved.key };
    return null;
  }

  // 2 — Session cookie (the operator path).
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (match) {
    const account = accountForSession(match[1]!);
    if (account) return { account, via: "session" };
  }
  return null;
}

/** True when the authenticated caller holds the scope (API keys only can). */
export function hasScope(auth: AuthenticatedRequest, scope: ApiKeyScope | null): boolean {
  if (scope === null) return true; // session callers may do what operators may do
  if (auth.via === "session") return true;
  return auth.apiKey?.scopes.includes(scope) ?? false;
}
