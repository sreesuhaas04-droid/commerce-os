/**
 * Customer reply grounding.
 *
 * The delivery template used to tell customers their parcel "has left our
 * warehouse but the courier has not scanned it since" — invented every time it
 * was sent, about a shipment no part of this system had observed. These tests
 * pin the rule that replaced it: what a customer is told about their order comes
 * from the order and its fulfilment row, or is not said at all.
 *
 * The deterministic path is what is asserted here. A model's prose cannot be
 * pinned by a unit test, which is exactly why the fallback — the thing that
 * ships when no model is configured — has to be right on its own.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { callTool } from "@/tools/executor";
import { runDueJobs } from "@/events/queue";
import "@/integrations/fulfillment-worker";
import { getDb } from "@/database/db";
import { seedDemo } from "@/simulation/seed";
import { getAgentImpl } from "@/agents";
import { getOrder, listOrders, listTickets } from "@/database/queries";
import { newCorrelationId } from "@/lib/ids";
import { rupees } from "@/lib/money";
import type { AgentId, Order, ToolContext } from "@/types";

const ctx = (agentId: AgentId): ToolContext => ({
  agentId,
  taskId: null,
  correlationId: newCorrelationId(),
});

/** The customer agent's reply batch size — only these tickets get answered in a run. */
const REPLY_BATCH = 6;

const paidOrder = (): Order => listOrders(200).find((o) => o.paymentStatus === "SUCCESS")!;

interface OrderState {
  summary: string;
  fulfillment: { status: string; supplierReference: string | null } | null;
}

const status = async (orderId: string): Promise<OrderState> => {
  const result = await callTool("get_order_status", { orderId }, ctx("customer"));
  expect(result.status).toBe("COMPLETED");
  return result.output as OrderState;
};

beforeAll(() => {
  seedDemo();
});

beforeEach(() => {
  getDb().run(`DELETE FROM job_queue`);
  getDb().run(`DELETE FROM fulfillments`);
});

describe("get_order_status", () => {
  it("says an order has not shipped when nothing has been sent to a supplier", async () => {
    const state = await status(paidOrder().id);

    expect(state.fulfillment).toBeNull();
    expect(state.summary).toContain("has not shipped");
  });

  it("reports the supplier's own reference once the order is accepted", async () => {
    const order = paidOrder();
    await callTool("fulfill_order", { orderId: order.id, reason: "handover" }, ctx("fulfillment"));
    await runDueJobs();

    const state = await status(order.id);

    expect(state.fulfillment!.status).toBe("SUBMITTED");
    expect(state.summary).toContain(state.fulfillment!.supplierReference!);
    // Accepted by a supplier is not the same as shipped, and must not read as it.
    expect(state.summary).toContain("no tracking number yet");
    expect(state.summary).not.toMatch(/\bshipped\b/i);
  });

  it("does not invent a status for an order that failed to reach the supplier", async () => {
    const order = paidOrder();
    await callTool("fulfill_order", { orderId: order.id, reason: "handover" }, ctx("fulfillment"));
    getDb().run(
      `UPDATE fulfillments SET status = 'EXCEPTION', last_error = 'ETIMEDOUT' WHERE order_id = ?`,
      order.id,
    );

    const state = await status(order.id);
    expect(state.summary).toContain("has not shipped");
    expect(state.summary).toMatch(/handled by a person/i);
  });

  it("carries no customer details, so a reply cannot leak them", async () => {
    const state = await status(paidOrder().id);
    const serialised = JSON.stringify(state).toLowerCase();

    expect(serialised).not.toContain("customer");
    expect(serialised).not.toContain("email");
  });

  it("refuses an order that does not exist rather than describing one", async () => {
    const result = await callTool("get_order_status", { orderId: "ord_nope" }, ctx("customer"));
    expect(result.status).toBe("FAILED");
  });
});

describe("replies the agent actually sends", () => {
  it("never claims a courier, warehouse or tracking number it cannot observe", async () => {
    // The whole open queue, answered end to end on the deterministic engine.
    await getAgentImpl("customer").run({
      correlationId: newCorrelationId(),
      taskId: null,
      priorResults: [],
    });

    const answered = listTickets().filter((ticket) => ticket.reply);
    expect(answered.length).toBeGreaterThan(0);

    for (const ticket of answered) {
      const reply = ticket.reply!;
      // Phrases that assert a physical event nothing in this system records.
      expect(reply).not.toMatch(/left our warehouse/i);
      expect(reply).not.toMatch(/courier has not scanned/i);
      expect(reply).not.toMatch(/opened a trace/i);
      expect(reply).not.toMatch(/tracking number is/i);
    }
  });

  it("never accuses a customer of an injection attempt in their own reply", async () => {
    // A live run once told someone who wrote "cancel my order" that their
    // message was "a suspected injection attempt" needing verification through
    // a secure channel. The security framing is internal; the customer sees a
    // business accusing them of an attack for asking a normal question.
    await getAgentImpl("customer").run({
      correlationId: newCorrelationId(),
      taskId: null,
      priorResults: [],
    });

    for (const ticket of listTickets().filter((t) => t.reply)) {
      expect(ticket.reply).not.toMatch(/injection/i);
      expect(ticket.reply).not.toMatch(/untrusted/i);
      expect(ticket.reply).not.toMatch(/secure channel/i);
    }
  });

  it("tells a customer the real state of an order that is with the supplier", async () => {
    // A delivery-themed ticket whose order is paid and under the ₹50,000
    // fulfilment auto-approval limit — the supplier reference appears in the
    // delivery reply template, so any other theme would answer honestly
    // without ever quoting it. Earlier tests in this file have answered the
    // whole queue, so the ticket is taken from any status and reopened.
    const ticket = listTickets()
      .find((t) => {
        if (!t.orderId) return false;
        if (!/\b(ship|delivery|tracking|arriv)/i.test(`${t.subject} ${t.body}`)) return false;
        const order = getOrder(t.orderId);
        return order?.paymentStatus === "SUCCESS" && order.costPaise <= rupees(50_000);
      })!;
    expect(ticket, "a delivery-themed ticket with a paid, small order must exist").toBeTruthy();
    await callTool(
      "fulfill_order",
      { orderId: ticket.orderId!, reason: "handover" },
      ctx("fulfillment"),
    );
    await runDueJobs();
    // Reopen it and clear any earlier reply, then force it into this run's
    // reply batch by closing everything else — the agent answers the first six
    // open tickets, and the batch must contain this one deterministically.
    getDb().run(`UPDATE tickets SET status = 'OPEN', reply = NULL WHERE id = ?`, ticket.id);
    getDb().run(
      `UPDATE tickets SET status = 'ANSWERED' WHERE id != ? AND status = 'OPEN'`,
      ticket.id,
    );

    await getAgentImpl("customer").run({
      correlationId: newCorrelationId(),
      taskId: null,
      priorResults: [],
    });

    const answered = listTickets().find((t) => t.id === ticket.id)!;
    const state = await status(ticket.orderId!);
    expect(answered.reply).toBeTruthy();
    expect(answered.reply).toContain(state.fulfillment!.supplierReference!);
  });
});
