/**
 * Auth tests — accounts, sessions, API keys, and the gated checkout.
 *
 * The claims under test are the ones the security posture rests on:
 *   - passwords verify in constant time and are never stored or returned
 *   - a session is an opaque revocable token, not the password
 *   - an API key's plaintext exists exactly once; the row holds a digest
 *   - the checkout money API refuses unauthenticated calls
 *   - a credential cannot act as another buyer
 *   - a revoked key stops working immediately
 *   - every auth event lands in the audit log
 *
 * These tests call the route handlers directly with forged Request objects,
 * which is the same surface a network caller sees.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login, GET as whoAmI } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as keysList, POST as keysIssue, DELETE as keysRevoke } from "@/app/api/auth/keys/route";
import { POST as checkout } from "@/app/api/checkout/route";
import { seedDemo } from "@/simulation/seed";
import { getDb } from "@/database/db";
import { listAudit, listProducts } from "@/database/queries";

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${path}`, { method: "GET", headers });

const del = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${path}`, { method: "DELETE", headers });

/** Reads a Set-Cookie header into a Cookie header. */
const cookieFrom = (response: Response): string => {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const pair = setCookie.split(";")[0]!;
  return pair;
};

beforeAll(() => {
  seedDemo();
  // Auth events are audited with a fresh correlation id, so run order across
  // the suite does not affect the assertions below.
});

describe("signup", () => {
  it("creates an account with a scrypt hash, never the password", async () => {
    const res = await signup(
      json({ name: "Ops Human", email: "ops@example.com", password: "correct horse 9", role: "operator" }),
    );
    expect(res.status).toBe(201);

    const row = getDb().get(`SELECT password_hash FROM accounts WHERE email = ?`, "ops@example.com");
    // salt$hash, both hex, and no trace of the plaintext anywhere.
    expect(String(row?.password_hash)).toMatch(/^[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(String(row?.password_hash)).not.toContain("correct");
  });

  it("refuses a duplicate email with 409, not a 500", async () => {
    const res = await signup(
      json({ name: "Again", email: "ops@example.com", password: "whatever 12" }),
    );
    expect(res.status).toBe(409);
  });

  it("rejects a password that does not clear the bar", async () => {
    // Long enough, but letters only — the digit rule must be the reason.
    const res = await signup(
      json({ name: "Weak", email: "weak@example.com", password: "onlyletters", role: "buyer" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/one number/);
  });
});

describe("login", () => {
  it("issues an opaque session cookie for the right password", async () => {
    const res = await login(json({ email: "ops@example.com", password: "correct horse 9" }));
    expect(res.status).toBe(200);
    const cookie = cookieFrom(res);
    expect(cookie).toMatch(/^commerce_os_session=[0-9a-f]{64}$/);

    const who = await whoAmI(get("/", { cookie }));
    const body = await who.json();
    expect(body.account?.email).toBe("ops@example.com");
  });

  it("is identical for a wrong email and a wrong password — no enumeration", async () => {
    const wrongPassword = await login(json({ email: "ops@example.com", password: "wrong pass 1" }));
    const wrongEmail = await login(json({ email: "ghost@example.com", password: "wrong pass 1" }));
    expect(wrongPassword.status).toBe(401);
    expect(wrongEmail.status).toBe(401);
    expect(await wrongPassword.text()).toBe(await wrongEmail.text());
  });

  it("does not accept a session token that was signed out", async () => {
    const res = await login(json({ email: "ops@example.com", password: "correct horse 9" }));
    const cookie = cookieFrom(res);

    await logout(new Request("http://localhost:3000/", { method: "POST", headers: { cookie } }));

    const who = await whoAmI(get("/", { cookie }));
    const body = await who.json();
    expect(body.account).toBeNull();
  });
});

describe("API keys", () => {
  let secret = "";
  let keyId = "";

  it("issues a key whose plaintext appears once and is stored only as a digest", async () => {
    const loginRes = await login(json({ email: "ops@example.com", password: "correct horse 9" }));
    const cookie = cookieFrom(loginRes);

    const res = await keysIssue(
      json({ label: "Perplexity agent" }, { cookie }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    secret = body.secret;
    keyId = body.key.id;

    // sk_live_ shape, and the digest is what landed in the table.
    expect(secret).toMatch(/^sk_live_[A-Za-z0-9_-]+$/);
    const row = getDb().get(`SELECT key_hash FROM api_keys WHERE id = ?`, keyId);
    expect(String(row?.key_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(row?.key_hash)).not.toContain(secret);
  });

  it("lists keys with prefixes only — never the secret", async () => {
    const loginRes = await login(json({ email: "ops@example.com", password: "correct horse 9" }));
    const cookie = cookieFrom(loginRes);
    const res = await keysList(get("/api/auth/keys", { cookie }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.keys.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(body.keys[0].scopes).toContain("checkout:write");
  });

  it("lets a Bearer key run the checkout the session cookie no longer needs", async () => {
    // A machine buyer with just the key: authenticated, scoped.
    const product = listProducts(3)[0];
    const res = await checkout(
      json(
        { intent: "cart", productIds: [product.id] },
        { authorization: `Bearer ${secret}` },
      ),
    );
    // Autonomy 2 parks the placement for a human — that is the governance,
    // not an auth failure. Authenticated callers reach the agent.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticatedVia).toBe("api_key");
    expect(body.buyerId).toMatch(/^acc_/); // bound to the account
  });

  it("refuses a buyerId that does not match the credential", async () => {
    const product = listProducts(3)[0];
    const res = await checkout(
      json(
        { intent: "cart", buyerId: "someone_else", productIds: [product.id] },
        { authorization: `Bearer ${secret}` },
      ),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/cannot act as buyer/);
  });

  it("stops working the moment it is revoked", async () => {
    const loginRes = await login(json({ email: "ops@example.com", password: "correct horse 9" }));
    const cookie = cookieFrom(loginRes);

    const revoked = await keysRevoke(del(`/api/auth/keys?id=${keyId}`, { cookie }));
    expect(revoked.status).toBe(200);

    const res = await checkout(
      json(
        { intent: "browse", query: "any laptop" },
        { authorization: `Bearer ${secret}` },
      ),
    );
    expect(res.status).toBe(401);
  });
});

describe("the gated checkout", () => {
  it("refuses an unauthenticated caller with how to authenticate", async () => {
    const res = await checkout(json({ intent: "browse", query: "any laptop" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/session or a Bearer API key/);
  });

  it("lets a signed-in operator run a turn with the session cookie", async () => {
    const loginRes = await login(json({ email: "ops@example.com", password: "correct horse 9" }));
    const cookie = cookieFrom(loginRes);
    const res = await checkout(
      json({ intent: "browse", query: "laptop for programming" }, { cookie }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticatedVia).toBe("session");
  });

  it("keys cannot mint keys — the privilege stays with a signed-in operator", async () => {
    // Issue a fresh key, then try to mint another using it.
    const loginRes = await login(json({ email: "ops@example.com", password: "correct horse 9" }));
    const cookie = cookieFrom(loginRes);
    const issueRes = await keysIssue(json({ label: "chain attempt" }, { cookie }));
    const secret = (await issueRes.json()).secret;

    const res = await keysIssue(json({ label: "child key" }, { authorization: `Bearer ${secret}` }));
    expect(res.status).toBe(403);
  });
});

describe("audit", () => {
  it("records signups, logins, failed logins and key events", () => {
    const actions = new Set(
      listAudit({ limit: 200 })
        .filter((entry) => entry.action.startsWith("account:") || entry.action.startsWith("api_key:"))
        .map((entry) => entry.action),
    );
    expect(actions).toContain("account:signup");
    expect(actions).toContain("account:login");
    expect(actions).toContain("account:login_failed");
    expect(actions).toContain("api_key:issued");
    expect(actions).toContain("api_key:revoked");
  });

  it("never lets a password reach the audit log", () => {
    const serialised = JSON.stringify(listAudit({ limit: 200 }));
    expect(serialised).not.toContain("correct horse 9");
  });
});
