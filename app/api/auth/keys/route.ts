/**
 * API key management, scoped to the caller's own account.
 *
 *   POST   /api/auth/keys        issue a key  → plaintext returned ONCE
 *   GET    /api/auth/keys        list keys     → prefixes and scopes only
 *   DELETE /api/auth/keys?id=…   revoke a key  → immediate, audited
 *
 * A key is the credential an AI buyer presents to /api/checkout. Issuing one
 * is a security-relevant action, so it requires a session (an operator on the
 * console) rather than another key — keys cannot mint keys.
 */
import { z } from "zod";
import {
  API_KEY_SCOPES,
  authenticate,
  issueApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKeyScope,
} from "@/lib/auth";
import { body, fail, handle, ok, ready, searchParam } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Payload = z.object({
  label: z.string().min(3).max(60),
  scopes: z
    .array(z.enum(API_KEY_SCOPES))
    .min(1)
    .default(["catalog:read", "checkout:write"] as ApiKeyScope[]),
});

export async function GET(request: Request) {
  try {
    ready();
    const auth = authenticate(request);
    if (!auth) return fail("Not signed in.", 401);
    if (auth.via !== "session") return fail("API keys cannot manage API keys — sign in.", 403);

    return ok({
      keys: listApiKeys(auth.account.id).map((key) => ({
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
    return handle(error, "auth/keys");
  }
}

export async function POST(request: Request) {
  try {
    ready();
    const auth = authenticate(request);
    if (!auth) return fail("Not signed in.", 401);
    if (auth.via !== "session") return fail("API keys cannot mint API keys — sign in.", 403);

    const parsed = await body(request, Payload);
    if (parsed.error) return parsed.error;

    const { record, plaintext } = issueApiKey({
      accountId: auth.account.id,
      label: parsed.data.label,
      scopes: parsed.data.scopes,
    });

    return ok(
      {
        key: {
          id: record.id,
          label: record.label,
          prefix: record.prefix,
          scopes: record.scopes,
          createdAt: record.createdAt,
        },
        // The only time the full key exists outside the caller's hands.
        secret: plaintext,
        warning:
          "Copy this key now — it is stored hashed and cannot be shown again. Present it as 'Authorization: Bearer <key>' on /api/checkout.",
      },
      { status: 201 },
    );
  } catch (error) {
    return handle(error, "auth/keys");
  }
}

export async function DELETE(request: Request) {
  try {
    ready();
    const auth = authenticate(request);
    if (!auth) return fail("Not signed in.", 401);
    if (auth.via !== "session") return fail("API keys cannot revoke keys — sign in.", 403);

    const id = searchParam(request, "id");
    if (!id) return fail("Provide the key id to revoke (?id=key_…).", 400);

    const revoked = revokeApiKey(auth.account.id, id);
    if (!revoked) return fail("No such active key on this account.", 404);

    return ok({ revoked: id });
  } catch (error) {
    return handle(error, "auth/keys");
  }
}
