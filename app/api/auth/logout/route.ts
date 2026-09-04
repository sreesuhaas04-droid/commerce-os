/**
 * POST /api/auth/logout — destroy the session cookie server-side.
 *
 * Deletes the session row, so a stolen cookie value stops working even before
 * it expires. Audited, like every auth event.
 */
import { ok, handle } from "@/lib/api";
import { SESSION_COOKIE, authenticate, deleteSession } from "@/lib/auth";
import { writeAudit } from "@/database/queries";
import { newId } from "@/lib/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = authenticate(request);
    const cookie = request.headers.get("cookie") ?? "";
    const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
    if (match) deleteSession(match[1]!);

    if (auth) {
      writeAudit({
        agentId: "system",
        action: "account:logout",
        entityType: "account",
        entityId: auth.account.id,
        input: null,
        output: null,
        policyResult: "ALLOW",
        approvalRequired: false,
        approvalStatus: null,
        risk: "LOW",
        executionStatus: "COMPLETED",
        correlationId: newId("cor"),
      });
    }

    const response = ok({ ok: true });
    // Expire the cookie client-side too.
    response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    return handle(error, "auth/logout");
  }
}
