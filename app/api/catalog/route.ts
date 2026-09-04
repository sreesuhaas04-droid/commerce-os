/**
 * Agent-readable catalogue — the entry point an external AI buyer reads first.
 *
 * Same builder as the internal `get_agent_catalog` tool, so the two cannot
 * drift. Public like any shop window: product, price, availability. It carries
 * no cost, margin or supplier data, because a buyer has no legitimate use for
 * the merchant's private economics.
 *
 * Authenticated by the same shared-password gate as the rest of the console
 * (proxy.ts) — an agent buyer is a first-class caller, not an anonymous one.
 */
import { buildAgentCatalog } from "@/tools/definitions";
import { handle, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    ready();
    const url = new URL(request.url);
    const catalog = buildAgentCatalog({
      category: url.searchParams.get("category") ?? undefined,
      inStockOnly: url.searchParams.get("inStock") === "true",
      limit: Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50))),
    });
    return ok(catalog);
  } catch (error) {
    return handle(error, "catalog");
  }
}
