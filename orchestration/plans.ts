/**
 * Plan templates.
 *
 * A plan is a task DAG built by matching a trigger against these templates.
 * This is deliberately deterministic: goal decomposition is the single most
 * load-bearing step in a live demo, and a model that produces a malformed plan
 * breaks everything downstream. The agents themselves still reason freely —
 * this only decides who is asked, and in what order.
 */
import type { AgentId, EventType, GoalMetric } from "@/types";

export interface TaskSpec {
  /** Stable within a plan; used to express dependencies. */
  key: string;
  agentId: AgentId;
  title: string;
  dependsOn: string[];
}

export interface PlanTemplate {
  id: string;
  title: string;
  /** Events that select this template. */
  triggers: EventType[];
  /** Goal metrics that select this template. */
  metrics: GoalMetric[];
  /** Free-text intents, matched case-insensitively as whole words. */
  intents: string[];
  tasks: TaskSpec[];
}

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    id: "revenue_investigation",
    title: "Investigate the revenue movement",
    triggers: ["REVENUE_ANOMALY", "PAYMENT_FAILED"],
    metrics: ["revenue", "conversion"],
    intents: ["why did sales drop", "revenue", "conversion", "sales fell", "checkout"],
    tasks: [
      { key: "analyse", agentId: "analytics", title: "Decompose the revenue change", dependsOn: [] },
      // These two run in parallel to rule their own domains in or out.
      { key: "stock", agentId: "inventory", title: "Rule out availability as a cause", dependsOn: ["analyse"] },
      { key: "price", agentId: "pricing", title: "Rule out pricing as a cause", dependsOn: ["analyse"] },
      { key: "voice", agentId: "customer", title: "Check what customers are reporting", dependsOn: ["analyse"] },
      // Depends on `analyse` as well as the three checks: the CEO must see the
      // decomposition itself, not only the domains that ruled themselves out.
      {
        key: "decide",
        agentId: "ceo",
        title: "Synthesise a root cause and a plan",
        dependsOn: ["analyse", "stock", "price", "voice"],
      },
    ],
  },
  {
    id: "stockout_response",
    title: "Respond to stockout risk",
    triggers: ["INVENTORY_LOW", "INVENTORY_OUT", "DEMAND_SPIKE"],
    metrics: ["stockouts"],
    intents: ["stockout", "inventory", "restock", "out of stock"],
    tasks: [
      { key: "assess", agentId: "inventory", title: "Assess cover against lead times", dependsOn: [] },
      { key: "source", agentId: "procurement", title: "Select suppliers and size orders", dependsOn: ["assess"] },
      // Depends on both: the CEO needs the stock position, not only the quotes.
      { key: "decide", agentId: "ceo", title: "Approve the replenishment position", dependsOn: ["assess", "source"] },
    ],
  },
  {
    id: "campaign_review",
    title: "Review campaign efficiency",
    triggers: ["CAMPAIGN_PERFORMANCE_CHANGED"],
    metrics: [],
    intents: ["campaign", "marketing", "roas", "ad spend"],
    tasks: [
      { key: "efficiency", agentId: "marketing", title: "Rank campaigns by return", dependsOn: [] },
      { key: "decide", agentId: "ceo", title: "Decide the budget position", dependsOn: ["efficiency"] },
    ],
  },
  {
    id: "competitor_response",
    title: "Respond to a competitor price move",
    triggers: ["COMPETITOR_PRICE_CHANGED", "PRICE_CHANGED"],
    metrics: ["margin"],
    intents: ["competitor", "price", "margin", "undercut"],
    tasks: [
      { key: "price", agentId: "pricing", title: "Reprice within the margin floor", dependsOn: [] },
      { key: "stock", agentId: "inventory", title: "Check we can supply the new demand", dependsOn: [] },
      { key: "decide", agentId: "ceo", title: "Settle the pricing position", dependsOn: ["price", "stock"] },
    ],
  },
  {
    id: "service_recovery",
    title: "Work the customer queue",
    triggers: ["CUSTOMER_MESSAGE_RECEIVED", "REFUND_REQUESTED", "CUSTOMER_RETURN_CREATED"],
    metrics: ["refund_rate", "repeat_rate"],
    intents: ["ticket", "refund", "customer", "complaint", "return"],
    tasks: [
      { key: "triage", agentId: "customer", title: "Triage and answer open tickets", dependsOn: [] },
      { key: "analyse", agentId: "analytics", title: "Check whether the pattern shows in the metrics", dependsOn: ["triage"] },
      { key: "decide", agentId: "ceo", title: "Decide on escalation", dependsOn: ["triage", "analyse"] },
    ],
  },
  {
    id: "supply_disruption",
    title: "Handle a supplier delay",
    triggers: ["SUPPLIER_DELAYED"],
    metrics: [],
    intents: ["supplier", "delay", "lead time"],
    tasks: [
      { key: "assess", agentId: "inventory", title: "Recompute cover with the new lead time", dependsOn: [] },
      { key: "source", agentId: "procurement", title: "Find an alternative supplier", dependsOn: ["assess"] },
      { key: "decide", agentId: "ceo", title: "Decide whether to pay for speed", dependsOn: ["assess", "source"] },
    ],
  },
  {
    id: "fulfilment_run",
    title: "Get paid orders to the supplier",
    // Neither trigger has a publisher in this simulation — a real storefront is
    // what fires them. They are declared because they are the correct triggers
    // for this plan, and it is reachable today by intent and from the scripted
    // demo. A template nobody can reach would be dead weight; one whose trigger
    // is honest about where it would come from is a seam.
    triggers: ["PAYMENT_SUCCESS", "ORDER_CREATED"],
    metrics: [],
    intents: ["fulfil", "fulfill", "dispatch", "ship orders", "handover", "supplier"],
    tasks: [
      { key: "handover", agentId: "fulfillment", title: "Hand paid orders to the supplier", dependsOn: [] },
      { key: "decide", agentId: "ceo", title: "Review the fulfilment position", dependsOn: ["handover"] },
    ],
  },
  {
    id: "full_business_review",
    title: "Full business review",
    triggers: [],
    metrics: ["profit"],
    intents: ["profit", "review everything", "full review", "increase profit", "grow"],
    tasks: [
      { key: "analyse", agentId: "analytics", title: "Establish where the business stands", dependsOn: [] },
      { key: "stock", agentId: "inventory", title: "Find stock risk and trapped capital", dependsOn: [] },
      { key: "price", agentId: "pricing", title: "Find margin opportunities", dependsOn: [] },
      { key: "campaigns", agentId: "marketing", title: "Find wasted spend", dependsOn: [] },
      { key: "voice", agentId: "customer", title: "Find recoverable customer problems", dependsOn: [] },
      { key: "source", agentId: "procurement", title: "Price the replenishment needed", dependsOn: ["stock"] },
      {
        key: "decide",
        agentId: "ceo",
        title: "Rank every opportunity and resolve conflicts",
        dependsOn: ["analyse", "price", "campaigns", "voice", "source"],
      },
    ],
  },
  {
    id: "ai_buyer_checkout",
    title: "Serve an AI buyer end to end",
    // Fired by the checkout tool when a machine cart is placed. Deliberately
    // small: one agent serves the buyer under its own governance, and the CEO
    // reviews the position afterwards.
    triggers: ["MACHINE_ORDER_CREATED"],
    metrics: [],
    intents: ["ai buyer", "machine order", "checkout", "conversational checkout"],
    tasks: [
      { key: "serve", agentId: "checkout", title: "Review the buyer's cart position", dependsOn: [] },
      { key: "decide", agentId: "ceo", title: "Review the machine-order position", dependsOn: ["serve"] },
    ],
  },
  {
    id: "upsell_campaign",
    title: "Grow the basket: upsell and campaign orchestration",
    triggers: ["CAMPAIGN_PERFORMANCE_CHANGED"],
    metrics: ["repeat_rate"],
    intents: ["upsell", "cross-sell", "grow revenue", "basket"],
    tasks: [
      // Marketing finds where demand is already flowing cheaply...
      { key: "campaigns", agentId: "marketing", title: "Rank campaigns by return", dependsOn: [] },
      // ...and the checkout agent drafts cross-sell offers from the real
      // catalogue for the categories that convert, so the offers a campaign
      // carries are ones a buyer can actually transact.
      { key: "offers", agentId: "checkout", title: "Draft grounded cross-sell offers", dependsOn: ["campaigns"] },
      { key: "decide", agentId: "ceo", title: "Decide the growth position", dependsOn: ["campaigns", "offers"] },
    ],
  },
];

const DEFAULT_TEMPLATE = PLAN_TEMPLATES.find((t) => t.id === "full_business_review")!;

export function templateForEvent(type: EventType): PlanTemplate | null {
  return PLAN_TEMPLATES.find((template) => template.triggers.includes(type)) ?? null;
}

export function templateForGoal(metric: GoalMetric): PlanTemplate {
  return PLAN_TEMPLATES.find((template) => template.metrics.includes(metric)) ?? DEFAULT_TEMPLATE;
}

/** Whole-word intent match, longest phrase first so "revenue" doesn't beat "why did sales drop". */
export function templateForIntent(text: string): PlanTemplate {
  const haystack = text.toLowerCase();
  const scored = PLAN_TEMPLATES.map((template) => {
    const hit = [...template.intents]
      .sort((a, b) => b.length - a.length)
      .find((intent) => haystack.includes(intent));
    return { template, length: hit?.length ?? 0 };
  }).filter((entry) => entry.length > 0);

  if (scored.length === 0) return DEFAULT_TEMPLATE;
  return scored.sort((a, b) => b.length - a.length)[0].template;
}

export const getTemplate = (id: string): PlanTemplate | undefined =>
  PLAN_TEMPLATES.find((template) => template.id === id);
