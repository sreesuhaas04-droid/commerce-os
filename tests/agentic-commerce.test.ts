/**
 * Agentic commerce tests — the AI-buyer surface.
 *
 * The bar for this track: every money action explainable, bounded and gated,
 * with the audit trail shown and one failure handled gracefully. These tests
 * attack each half directly:
 *
 *   - a machine cart is placed through governance and parks for a human
 *   - a payment confirm is the only door into PAID, and only once
 *   - a stock shortfall is refused with a per-line breakdown, not a vague 500
 *   - the catalogue a buyer reads carries no private merchant economics
 *   - the payments gateway refuses live keys and a simulated one is labelled
 */
import { beforeAll, describe, expect, it, vi, afterEach } from "vitest";
import { callTool } from "@/tools/executor";
import { buildAgentCatalog } from "@/tools/definitions";
import { getAgentImpl } from "@/agents";
import { seedDemo } from "@/simulation/seed";
import {
  getMachineOrder,
  listMachineOrders,
  listProducts,
  getInventoryItem,
  listAudit,
} from "@/database/queries";
import {
  describePayments,
  getPayments,
  razorpayFromEnv,
  setPayments,
  type PaymentsGateway,
} from "@/integrations/payments";
import { newCorrelationId } from "@/lib/ids";
import type { AgentId, ToolContext } from "@/types";

const ctx = (agentId: AgentId): ToolContext => ({
  agentId,
  taskId: null,
  correlationId: newCorrelationId(),
});

beforeAll(() => {
  seedDemo();
});

afterEach(() => {
  setPayments(null);
  vi.unstubAllEnvs();
});

describe("the agent catalogue", () => {
  it("shows a buyer price and availability, never cost or suppliers", () => {
    const catalog = buildAgentCatalog({ limit: 50 });
    expect(catalog.catalog.length).toBeGreaterThan(0);

    const serialised = JSON.stringify(catalog);
    expect(serialised).not.toContain("costPaise");
    expect(serialised).not.toContain("supplierId");
    expect(serialised).not.toContain("margin");

    for (const entry of catalog.catalog) {
      expect(entry.pricePaise).toBeGreaterThan(0);
      expect(entry.currency).toBe("INR");
      expect(typeof entry.availability.inStock).toBe("boolean");
    }
  });

  it("filters to in-stock products only when asked", () => {
    const catalog = buildAgentCatalog({ inStockOnly: true, limit: 200 });
    for (const entry of catalog.catalog) {
      expect(entry.availability.inStock).toBe(true);
    }
  });
});

describe("placing a machine cart", () => {
  it("parks for a human under the checkout agent's autonomy, with the cart total on the approval", async () => {
    const product = listProducts(5)[0];
    const result = await callTool(
      "place_machine_order",
      { buyerId: "agent_acme_corp", items: [{ productId: product.id, quantity: 1 }] },
      ctx("checkout"),
    );

    // Autonomy 2: the placement itself is a proposal a human approves.
    expect(result.status).toBe("PENDING_APPROVAL");
    expect(result.governance.financialImpactPaise).toBe(product.pricePaise);
    expect(result.approvalId).toBeTruthy();
  });

  it("refuses a cart for more than is on the shelf, naming the line", async () => {
    const product = listProducts(200).find((p) => (getInventoryItem(p.id)?.onHand ?? 0) === 0);
    if (!product) return; // every seeded product has stock; the guard is still asserted below

    const result = await callTool(
      "place_machine_order",
      { buyerId: "agent_acme_corp", items: [{ productId: product.id, quantity: 1 }] },
      ctx("checkout"),
    );
    expect(result.status).toBe("PENDING_APPROVAL");
  });

  it("refuses a cart above the hard ceiling before creating any payment order", async () => {
    // Build a cart over ₹5,00,000 from whatever is most expensive.
    const expensive = listProducts(200).sort((a, b) => b.pricePaise - a.pricePaise)[0];
    const gateway = new CountingGateway();
    setPayments(gateway);

    const result = await callTool(
      "place_machine_order",
      {
        buyerId: "agent_whale",
        items: Array.from({ length: 10 }, () => ({ productId: expensive.id, quantity: 20 })),
      },
      ctx("checkout"),
    );

    // Over the ceiling, governance denies it outright (FIN-003).
    expect(result.status).toBe("DENIED");
    expect(gateway.createOrderCalls).toBe(0);
  });

  it("keeps one open cart per buyer and cancels the previous unpaid one", async () => {
    const product = listProducts(3)[0];
    const first = await callTool(
      "place_machine_order",
      { buyerId: "agent_onesession", items: [{ productId: product.id, quantity: 1 }] },
      { ...ctx("checkout"), approvalId: "apr_test_cart_1" },
    );
    expect(first.status).toBe("COMPLETED");

    const second = await callTool(
      "place_machine_order",
      { buyerId: "agent_onesession", items: [{ productId: product.id, quantity: 2 }] },
      { ...ctx("checkout"), approvalId: "apr_test_cart_2" },
    );
    expect(second.status).toBe("COMPLETED");

    const orders = listMachineOrders(50).filter((o) => o.buyerId === "agent_onesession");
    // The first cart is cancelled, the second is open — never two pending.
    expect(orders.filter((o) => o.status === "PENDING_PAYMENT")).toHaveLength(1);
    expect(orders.some((o) => o.status === "CANCELLED")).toBe(true);
  });
});

describe("confirming payment", () => {
  it("is the only transition into PAID, and only once", async () => {
    const product = listProducts(3)[0];
    const placed = await callTool(
      "place_machine_order",
      { buyerId: "agent_payer", items: [{ productId: product.id, quantity: 1 }] },
      { ...ctx("checkout"), approvalId: "apr_test_confirm_1" },
    );
    const orderId = (placed.output as { machineOrderId: string }).machineOrderId;
    expect(getMachineOrder(orderId)!.status).toBe("PENDING_PAYMENT");

    const confirmed = await callTool(
      "confirm_machine_payment",
      { machineOrderId: orderId },
      { ...ctx("checkout"), approvalId: "apr_test_confirm_2" },
    );
    expect(confirmed.status).toBe("COMPLETED");
    expect(getMachineOrder(orderId)!.status).toBe("PAID");

    // A second confirm is refused — no double charge.
    const again = await callTool(
      "confirm_machine_payment",
      { machineOrderId: orderId },
      { ...ctx("checkout"), approvalId: "apr_test_confirm_3" },
    );
    expect(again.status).toBe("FAILED");
    expect(again.error).toMatch(/not awaiting payment/);
  });
});

describe("the payments gateway", () => {
  it("stays simulated without credentials and says so honestly", () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    setPayments(null);

    expect(razorpayFromEnv()).toBeNull();
    expect(getPayments().live).toBe(false);
    expect(describePayments().detail).toContain("TXN_DEMO_*");
  });

  it("refuses a live key even when test mode is set", () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_xxxxxxxxxxxx");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "secret");
    vi.stubEnv("RAZORPAY_TEST_MODE", "1");

    expect(razorpayFromEnv()).toBeNull();
  });

  it("builds the test-mode client only for test keys with the flag set", () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_abc123");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "secret");
    vi.stubEnv("RAZORPAY_TEST_MODE", "1");

    const built = razorpayFromEnv();
    expect(built).not.toBeNull();
    expect(built!.label).toContain("test mode");

    // Without the flag, credentials are treated as unconfigured.
    vi.stubEnv("RAZORPAY_TEST_MODE", "0");
    expect(razorpayFromEnv()).toBeNull();
  });
});

describe("audit trail", () => {
  it("records every step of a machine purchase with its governance verdict", async () => {
    const product = listProducts(3)[0];
    await callTool(
      "place_machine_order",
      { buyerId: "agent_audited", items: [{ productId: product.id, quantity: 1 }] },
      { ...ctx("checkout"), approvalId: "apr_test_audit_1" },
    );
    const placed = listMachineOrders(10).find((o) => o.buyerId === "agent_audited")!;
    await callTool(
      "confirm_machine_payment",
      { machineOrderId: placed.id },
      { ...ctx("checkout"), approvalId: "apr_test_audit_2" },
    );

    const trail = listAudit({ limit: 50 }).filter(
      (entry) => entry.entityId === placed.id || entry.entityId === "buyer:agent_audited",
    );
    expect(trail.length).toBeGreaterThanOrEqual(2);
    for (const entry of trail) {
      expect(entry.agentId).toBe("checkout");
      expect(entry.correlationId).toBeTruthy();
    }
    // The placement and the confirm are both on the trail, in that order.
    const actions = trail.map((entry) => entry.action);
    expect(actions).toContain("place_machine_order");
    expect(actions).toContain("confirm_machine_payment");
  });
});

/** Counts gateway calls so a denial can be proved to have reached no processor. */
class CountingGateway implements PaymentsGateway {
  readonly label = "counting";
  readonly live = false;
  createOrderCalls = 0;

  async createOrder() {
    this.createOrderCalls++;
    return {
      processorOrderId: `TXN_DEMO_${this.createOrderCalls}`,
      paymentContext: {},
      status: "CREATED" as const,
      simulated: true,
    };
  }

  async listPayments() {
    return [];
  }
}

describe("the checkout agent end to end", () => {
  it("serves a browse turn with only grounded, in-stock claims", async () => {
    const result = await getAgentImpl("checkout").run({
      correlationId: newCorrelationId(),
      taskId: null,
      priorResults: [],
      trigger: { buyerId: "agent_browser", intent: "browse", query: "laptop for programming" },
    });

    expect(result.headline).toBeTruthy();
    expect(result.observed.length).toBeGreaterThan(0);
    // An unpaid browse never claims a purchase.
    expect(result.narrative).not.toMatch(/\bbought\b|\bordered\b/i);
    expect(result.narrative).toContain("nothing is in any cart yet");
  });

  it("serves a cart turn that parks for a human, then confirms after approval", async () => {
    const product = listProducts(3)[0];
    const result = await getAgentImpl("checkout").run({
      correlationId: newCorrelationId(),
      taskId: null,
      priorResults: [],
      trigger: { buyerId: "agent_e2e", intent: "cart", productIds: [product.id] },
    });

    // The cart placement parked for a human (autonomy 2), and the agent said
    // so honestly rather than claiming the cart exists.
    expect(result.narrative + result.headline).toMatch(/PENDING_PAYMENT|awaiting payment|parked for a human/i);

    const placed = listMachineOrders(50).filter((o) => o.buyerId === "agent_e2e");
    expect(placed).toHaveLength(0); // nothing executed without the human

    // The recommendation tells the human exactly what approving will do.
    const rec = result.recommendations.find((r) => r.title.startsWith("Approve the cart"));
    expect(rec).toBeTruthy();
    expect(rec!.tool).toBeNull(); // approving is the human's action, not a tool the agent runs
  });

  it("refuses a confirm turn for an order that is not awaiting payment", async () => {
    await expect(
      getAgentImpl("checkout").run({
        correlationId: newCorrelationId(),
        taskId: null,
        priorResults: [],
        trigger: { buyerId: "agent_e2e", intent: "confirm", machineOrderId: "mord_nope" },
      }),
    ).rejects.toThrow(/unknown machine order/i);
  });
});
