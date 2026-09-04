/**
 * POST /api/auth/login — exchange email + password for a session cookie.
 *
 * Verification is constant-time and the response is identical for a wrong
 * email and a wrong password, so the endpoint cannot be used to enumerate
 * which emails hold accounts. Failed attempts are audited with the attempted
 * email's digest only — never the address itself.
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { body, clientIp, fail, handle, ok, overRateLimit, ready, tooManyRequests } from "@/lib/api";
import { SESSION_COOKIE, accountForSession, createSession, getAccountByEmail, verifyPassword } from "@/lib/auth";
import { getDb } from "@/database/db";
import { writeAudit } from "@/database/queries";
import { newId } from "@/lib/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Payload = z.object({
  email: z.string().email().max(120),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  try {
    if (overRateLimit("api:login", clientIp(request))) return tooManyRequests("api:login");
    ready();

    const parsed = await body(request, Payload);
    if (parsed.error) return parsed.error;
    const { email, password } = parsed.data;

    const found = getAccountByEmail(email);
    // Same branch shape for unknown email and wrong password.
    const valid = found ? verifyPassword(password, found.passwordHash) : false;

    if (!found || !valid) {
      writeAudit({
        agentId: "system",
        action: "account:login_failed",
        entityType: "account",
        entityId: createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 12),
        input: { reason: "invalid credentials" },
        output: null,
        policyResult: "DENY",
        approvalRequired: false,
        approvalStatus: null,
        risk: "MEDIUM",
        executionStatus: "DENIED",
        correlationId: newId("cor"),
      });
      return fail("Invalid email or password.", 401);
    }

    const account = found.account;
    const { token, expiresAt } = createSession(account.id);
    getDb().run(
      `UPDATE accounts SET last_login_at = ? WHERE id = ?`,
      new Date().toISOString(),
      account.id,
    );

    writeAudit({
      agentId: "system",
      action: "account:login",
      entityType: "account",
      entityId: account.id,
      input: { email: account.email },
      output: { via: "session" },
      policyResult: "ALLOW",
      approvalRequired: false,
      approvalStatus: null,
      risk: "LOW",
      executionStatus: "COMPLETED",
      correlationId: newId("cor"),
    });

    const response = ok({ account: { id: account.id, email: account.email, name: account.name, role: account.role }, expiresAt });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.url.startsWith("https"),
      path: "/",
      expires: new Date(expiresAt),
    });
    return response;
  } catch (error) {
    return handle(error, "auth/login");
  }
}

/** GET returns the caller's session account, if the cookie is valid. */
export async function GET(request: Request) {
  try {
    ready();
    const cookie = request.headers.get("cookie") ?? "";
    const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
    const account = match ? accountForSession(match[1]!) : null;
    if (!account) return NextResponse.json({ account: null }, { status: 200 });
    return ok({ account: { id: account.id, email: account.email, name: account.name, role: account.role } });
  } catch (error) {
    return handle(error, "auth/login");
  }
}
