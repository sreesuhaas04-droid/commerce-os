/**
 * GET /api/auth/me — who am I, and what keys do I hold?
 *
 * Session-authenticated (an API key has no need to list itself). Returns the
 * account and its API keys with prefixes and scopes only — never a digest
 * that could be reversed, never a plaintext that does not exist.
 */
import { fail, handle, ok, ready } from "@/lib/api";
import { authenticate, listApiKeys } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    ready();
    const auth = authenticate(request);
    if (!auth) return fail("Not signed in.", 401);

    return ok({
      account: {
        id: auth.account.id,
        email: auth.account.email,
        name: auth.account.name,
        role: auth.account.role,
        createdAt: auth.account.createdAt,
        lastLoginAt: auth.account.lastLoginAt,
      },
      via: auth.via,
      apiKeys: listApiKeys(auth.account.id).map((key) => ({
        id: key.id,
        label: key.label,
        prefix: key.prefix,
        scopes: key.scopes,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
        revokedAt: key.revokedAt,
      })),
    });
  } catch (error) {
    return handle(error, "auth/me");
  }
}
