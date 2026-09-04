/**
 * Checkout Agent — conversational checkout for AI buyers.
 *
 * The other agents investigate the business; this one serves a buyer. A run is
 * one conversation turn driven by a typed buyer intent, not open-ended
 * exploration:
 *
 *   browse   → catalog slice against the buyer's stated need
 *   cart     → stock-checked cart, placed as PENDING_PAYMENT (parks for a human
 *              under autonomy 2 — the human sees exactly what will be bought)
 *   confirm  → reviews an order awaiting payment; the confirm tool itself is
 *              recommended to the buyer, and parks for a human
 *
 * Every claim the agent makes is drawn from tool output: products, prices and
 * stock from the catalog and cart tools, totals from the machine order row. A
 * total is never computed in prose, and an unpaid cart is never called bought.
 */
import { z } from "zod";
import {
  evidence,
  mutatingCaller,
  reason,
  recommendation,
  runAgent,
  toolCaller,
  untrusted,
  type Agent,
  type AgentRunContext,
} from "./runtime";
import { AGENTS } from "./definitions";
import { formatMoney } from "@/lib/money";
import type { AgentResult, Recommendation } from "@/types";

/** What one buyer turn asks for. Validated before the run, not inferred. */
export const BuyerIntent = z.enum(["browse", "cart", "confirm"]);
export type BuyerIntent = z.infer<typeof BuyerIntent>;

export interface CheckoutRequest {
  buyerId: string;
  intent: BuyerIntent;
  /** Browse: the stated need. Cart: product ids to buy. Confirm: order id. */
  query?: string;
  productIds?: string[];
  machineOrderId?: string;
}

const Assessment = z.object({ summary: z.string(), narrative: z.string() });

interface CatalogEntry {
  productId: string;
  sku: string;
  name: string;
  pricePaise: number;
  availability: { inStock: boolean; onHand: number; leadTimeDays: number | null };
}

interface MachineOrderView {
  machineOrderId: string;
  status: "PENDING_PAYMENT" | "PAID" | "CANCELLED";
  totalPaise: number;
  lines: { productId: string; quantity: number; unitPricePaise: number }[];
}

const Payload = z
  .object({
    buyerId: z.string().min(3).max(64),
    intent: BuyerIntent,
    query: z.string().max(300).optional(),
    productIds: z.array(z.string()).max(10).optional(),
    machineOrderId: z.string().optional(),
  })
  .refine((data) => data.intent !== "browse" || (data.query?.length ?? 0) >= 2, {
    message: "a browse turn needs a query",
  })
  .refine((data) => data.intent !== "cart" || (data.productIds?.length ?? 0) > 0, {
    message: "a cart turn needs product ids",
  })
  .refine((data) => data.intent !== "confirm" || Boolean(data.machineOrderId), {
    message: "a confirm turn needs a machine order id",
  });

/** A buyer turn is untrusted input: it is wrapped before it reaches a model. */
export const checkoutAgent: Agent = {
  id: "checkout",
  run: (ctx: AgentRunContext): Promise<AgentResult> =>
    runAgent("checkout", ctx, "Serving an AI buyer", async () => {
      const parsed = Payload.safeParse(ctx.trigger ?? {});
      if (!parsed.success) {
        throw new Error(`Checkout run needs a buyer request: ${parsed.error.issues[0]?.message}`);
      }
      const request = parsed.data;
      const call = toolCaller("checkout", ctx);

      const observed: AgentResult["observed"] = [];
      const recommendations: Recommendation[] = [];
      let deterministic: { summary: string; narrative: string };
      let modelContext: string;

      if (request.intent === "browse") {
        const query = request.query ?? "";
        const results = await call<
          { product: { id: string; name: string; pricePaise: number }; score: number; reasons: string[] }[]
        >("get_product_recommendations", { query, limit: 4 });
        const catalog = await call<{ catalog: CatalogEntry[] }>("get_agent_catalog", {
          inStockOnly: true,
          limit: 50,
        });
        const byId = new Map(catalog.catalog.map((entry) => [entry.productId, entry]));

        observed.push(evidence("In-stock catalogue", String(catalog.catalog.length)));
        observed.push(evidence("Matches for the stated need", String(results.length), query.slice(0, 80)));

        // Only matches that are actually in the catalogue's stock are offered.
        const lines = results
          .map((r) => byId.get(r.product.id))
          .filter((entry): entry is CatalogEntry => Boolean(entry))
          .map((entry) => `${entry.name} at ${formatMoney(entry.pricePaise)}`);
        deterministic = {
          summary:
            lines.length === 0
              ? "Nothing in stock matches that need."
              : `${lines.length} in-stock products match the stated need.`,
          narrative:
            lines.length === 0
              ? `Nothing in the current in-stock catalogue matches "${query}". No availability is being claimed.`
              : `For "${query}", these in-stock products match: ${lines.join("; ")}. Prices are per product; nothing is in any cart yet.`,
        };
        modelContext = `Buyer asked for: ${query}\nIn-stock matches: ${lines.join("; ") || "(none)"}`;
      } else if (request.intent === "cart") {
        const items = request.productIds!.map((productId) => ({ productId, quantity: 1 }));
        const upsell = await call<{
          offers: { productId: string; name: string; pricePaise: number; reason: string }[];
        }>("draft_upsell_offers", { productIds: request.productIds!, maxOffers: 2 });

        // The cart is a money action: it goes through governance, and under
        // this agent's autonomy it parks for a human. The run is honest about
        // both outcomes — an executed cart and a parked proposal read
        // differently, and a parked cart is never described as placed.
        const mutation = await mutatingCaller("checkout", ctx)(
          "place_machine_order",
          { buyerId: request.buyerId, items },
        );

        if (mutation.status === "PENDING_APPROVAL") {
          const approvalId = mutation.approvalId!;
          observed.push(
            evidence("Cart proposal", approvalId, "Parked for a human; nothing has executed"),
          );
          recommendations.push(
            recommendation("checkout", {
              title: `Approve the cart for buyer ${request.buyerId} (${formatMoney(mutation.governance.financialImpactPaise)})`,
              rationale:
                `The cart is proposed and parked for human approval under the checkout agent's autonomy. ` +
                `Its value is ${formatMoney(mutation.governance.financialImpactPaise)}, computed from catalogue prices. ` +
                `Approving places it as PENDING_PAYMENT; nothing has been bought yet.`,
              tool: null,
              input: null,
              estimatedImpactPaise: mutation.governance.financialImpactPaise,
              confidence: 0.9,
              risk: mutation.governance.risk,
            }),
          );
          deterministic = {
            summary: `Cart proposed for ${formatMoney(mutation.governance.financialImpactPaise)} — waiting for a human to approve the placement.`,
            narrative:
              `I built the cart from the catalogue and checked it against real stock, and the placement is ` +
              `parked for a human: nothing is placed and nothing is bought. Approving the request puts the cart in ` +
              `PENDING_PAYMENT. ` +
              (upsell.offers.length > 0
                ? `If it goes ahead, these in-stock items pair with it: ${upsell.offers
                    .map((o) => `${o.name} at ${formatMoney(o.pricePaise)}`)
                    .join("; ")}.`
                : `No cross-sell offer qualifies right now.`),
          };
          modelContext =
            `Cart proposed for buyer ${request.buyerId}, value ${formatMoney(mutation.governance.financialImpactPaise)}, ` +
            `PARKED for human approval. Offers drafted: ${
              upsell.offers.map((o) => `${o.name} ${formatMoney(o.pricePaise)}`).join("; ") || "none"
            }`;
        } else if (mutation.status === "DENIED" || mutation.status === "FAILED") {
          // The graceful failure: the buyer hears what went wrong and which
          // line fell short, not an opaque refusal.
          throw new Error(mutation.error ?? "The cart could not be placed");
        } else {
          const result = mutation.output as MachineOrderView & {
            payment: { processorOrderId: string; simulated: boolean };
            note: string;
          };

          observed.push(
            evidence(
              "Cart placed",
              result.machineOrderId,
              `${result.lines.length} lines, ${formatMoney(result.totalPaise)}`,
            ),
          );
          observed.push(evidence("Payment reference", result.payment.processorOrderId, result.note));
          if (upsell.offers.length > 0) {
            observed.push(
              evidence(
                "Cross-sell offers drafted",
                String(upsell.offers.length),
                upsell.offers.map((o) => o.name).join(", "),
              ),
            );
          }

          recommendations.push(
            recommendation("checkout", {
              title: `Confirm payment on cart ${result.machineOrderId} (${formatMoney(result.totalPaise)})`,
              rationale:
                `The cart is placed and awaiting payment. Confirming records the payment and moves the order to PAID; ` +
                `the total is ${formatMoney(result.totalPaise)} and was computed by the order tool, not estimated here.`,
              tool: "confirm_machine_payment",
              input: { machineOrderId: result.machineOrderId },
              estimatedImpactPaise: result.totalPaise,
              confidence: 0.9,
              risk: "MEDIUM",
            }),
          );

          deterministic = {
            summary: `Cart ${result.machineOrderId} placed for ${formatMoney(result.totalPaise)}, awaiting payment.`,
            narrative:
              `The cart holds ${result.lines.length} line(s) totalling ${formatMoney(result.totalPaise)}. ` +
              `It is PENDING_PAYMENT — nothing is bought until payment is confirmed. ` +
              (upsell.offers.length > 0
                ? `Also available, from the same category and in stock: ${upsell.offers
                    .map((o) => `${o.name} at ${formatMoney(o.pricePaise)}`)
                    .join("; ")}.`
                : `No cross-sell offer qualifies right now.`),
          };
          modelContext =
            `Cart ${result.machineOrderId}: ${result.lines.length} lines, total ${formatMoney(result.totalPaise)}, PENDING_PAYMENT.\n` +
            `Cross-sell offers drafted from the catalogue: ${
              upsell.offers.map((o) => `${o.name} ${formatMoney(o.pricePaise)}`).join("; ") || "none"
            }`;
        }
      } else {
        const order = await call<MachineOrderView>("get_machine_order", {
          machineOrderId: request.machineOrderId!,
        });
        if (order.status !== "PENDING_PAYMENT") {
          throw new Error(
            `Order ${order.machineOrderId} is ${order.status.toLowerCase()} — there is nothing to confirm`,
          );
        }

        recommendations.push(
          recommendation("checkout", {
            title: `Confirm payment on order ${order.machineOrderId} (${formatMoney(order.totalPaise)})`,
            rationale:
              `The order is PENDING_PAYMENT with a total of ${formatMoney(order.totalPaise)} computed by the order tool. ` +
              `Confirming records the payment; it parks for a human under the checkout agent's autonomy, ` +
              `and an already-paid order is refused rather than charged twice.`,
            tool: "confirm_machine_payment",
            input: { machineOrderId: order.machineOrderId },
            estimatedImpactPaise: order.totalPaise,
            confidence: 0.9,
            risk: "MEDIUM",
          }),
        );

        deterministic = {
          summary: `Order ${order.machineOrderId} is awaiting payment (${formatMoney(order.totalPaise)}).`,
          narrative:
            `The order is PENDING_PAYMENT with ${order.lines.length} line(s) totalling ${formatMoney(order.totalPaise)}. ` +
            `Payment is confirmed only through confirm_machine_payment, which parks for a human — nothing has been charged.`,
        };
        modelContext =
          `Order ${order.machineOrderId}, ${order.status}, total ${formatMoney(order.totalPaise)}. ` +
          `Confirming payment requires the confirm_machine_payment tool, which parks for a human.`;
      }

      const { value, engine } = await reason({
        kind: "checkout.turn",
        schema: Assessment,
        system: AGENTS.checkout.instructions,
        user: untrusted("buyer", modelContext),
        fallback: () => deterministic,
      });

      return {
        headline: value.summary,
        observed,
        inference: [],
        recommendations,
        narrative: value.narrative,
        engine,
      };
    }),
};
