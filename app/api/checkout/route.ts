/**
 * Conversational checkout for AI buyers.
 *
 * One request is one buyer turn: browse, cart, or confirm. The turn runs the
 * Checkout Agent, whose tool calls go through the same governance pipeline as
 * every other agent's — permission, policy, risk, budget — so placing a cart
 * and confirming a payment are explainable, bounded and audited exactly like a
 * refund or a purchase order.
 *
 * Authenticated: session cookie (an operator testing the flow) or a Bearer API
 * key with the checkout:write scope (a real machine buyer). The buyerId of the
 * turn is forced to the authenticated account — a caller cannot impersonate
 * another buyer, because every cart, payment and audit row ties to who actually
 * presented credentials.
 *
 * The failure the bar asks to see handled gracefully is the stock one: a cart
 * for more than is on the shelf is refused by the tool with a per-line
 * breakdown, and the response says which line fell short rather than failing
 * opaquely. A confirm on an already-paid order is a 409-shaped answer, not a
 * second charge.
 */
import { z } from "zod";
import { getAgentImpl } from "@/agents";
import { newCorrelationId } from "@/lib/ids";
import {
  body,
  clientIp,
  fail,
  handle,
  ok,
  overRateLimit,
  ready,
  tooManyRequests,
} from "@/lib/api";
import { authenticate, hasScope } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Payload = z
  .object({
    /** Optional when authenticated — the account becomes the buyer. */
    buyerId: z.string().min(3).max(64).optional(),
    intent: z.enum(["browse", "cart", "confirm"]),
    query: z.string().min(2).max(300).optional(),
    productIds: z.array(z.string()).min(1).max(10).optional(),
    machineOrderId: z.string().optional(),
  })
  .refine((data) => data.intent !== "browse" || (data.query?.length ?? 0) >= 2, {
    message: "a browse turn needs a query of at least 2 characters",
  })
  .refine((data) => data.intent !== "cart" || (data.productIds?.length ?? 0) > 0, {
    message: "a cart turn needs at least one productId",
  })
  .refine((data) => data.intent !== "confirm" || Boolean(data.machineOrderId), {
    message: "a confirm turn needs a machineOrderId",
  });

export async function POST(request: Request) {
  try {
    if (overRateLimit("api:ask", clientIp(request))) return tooManyRequests("api:ask");
    ready();

    const auth = authenticate(request);
    if (!auth) {
      return fail(
        "Authenticate with a session or a Bearer API key holding checkout:write. Keys are issued at /api/auth/keys.",
        401,
      );
    }
    // Scope check applies to API keys; sessions are operators by definition.
    if (!hasScope(auth, "checkout:write")) {
      return fail("This key lacks the checkout:write scope.", 403);
    }

    const parsed = await body(request, Payload);
    if (parsed.error) return parsed.error;

    // The buyer is who authenticated. A caller-supplied buyerId that disagrees
    // with the account is refused rather than silently overridden — the agent
    // ecosystem's equivalent of refusing to act on someone else's behalf.
    const buyerId = parsed.data.buyerId ?? auth.account.id;
    if (parsed.data.buyerId && parsed.data.buyerId !== auth.account.id) {
      return fail(
        `This credential belongs to ${auth.account.id}; it cannot act as buyer ${parsed.data.buyerId}.`,
        403,
      );
    }

    const result = await getAgentImpl("checkout").run({
      correlationId: newCorrelationId(),
      taskId: null,
      priorResults: [],
      trigger: { ...parsed.data, buyerId },
    });

    return ok({
      buyerId,
      intent: parsed.data.intent,
      authenticatedVia: auth.via,
      result,
    });
  } catch (error) {
    return handle(error, "checkout");
  }
}
