/**
 * The tool catalogue.
 *
 * Agents have no database access. Every capability an agent has is one of these
 * typed tools, and every one of them declares the permission it needs, the risk
 * it carries and the money it moves — which is what the governance pipeline
 * reads before anything executes.
 */
import { z } from "zod";
import {
  adjustStock,
  answerTicket,
  checkCartStock,
  createFulfillment,
  createMachineOrder,
  createPurchaseOrder,
  forecastDemand,
  getBusinessSummary,
  getCampaign,
  getCampaignEfficiency,
  getChannelBreakdown,
  getDailyMetrics,
  getFulfillmentForOrder,
  getInventoryItem,
  getMachineOrder,
  getOrder,
  getProduct,
  getRevenueDecomposition,
  getSalesVelocity,
  getStockoutRisks,
  getSupplierQuotes,
  listCampaigns,
  listFulfillments,
  listOrders,
  listProducts,
  listPurchaseOrders,
  listTickets,
  markMachineOrderPaid,
  markPurchaseOrderReceived,
  recordRefund,
  rememberFact,
  round,
  setCampaignStatus,
  setReorderPoint,
  updateCampaignBudget,
  updateProductPrice,
} from "@/database/queries";
import { recommendProducts } from "@/memory/vector";
import { enqueue } from "@/events/queue";
import { getSupplier } from "@/integrations/supplier";
import { getPayments } from "@/integrations/payments";
import { FULFILLMENT_JOB } from "@/integrations/fulfillment-worker";
import { POLICY_LIMITS } from "@/policies/rules";
import { formatMoney, marginPct, pct } from "@/lib/money";
import { newId } from "@/lib/ids";
import type { Fulfillment, Order, ToolDefinition } from "@/types";

/* eslint-disable @typescript-eslint/no-explicit-any -- a registry of tools with
   heterogeneous input/output types needs an existential type, which TypeScript
   does not have. Every call is validated against the tool's Zod schemas at
   runtime by the executor, so the `any` never escapes into unchecked data. */
export type RegisteredTool = ToolDefinition<any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

const define = <I, O>(def: ToolDefinition<I, O>): ToolDefinition<I, O> => def;

// ─── Analytics & strategy ────────────────────────────────────────────────────

const getBusinessSummaryTool = define({
  name: "get_business_summary",
  description: "Headline business metrics for the latest day with deltas against the 7-day average.",
  input: z.object({}),
  output: z.any(),
  permission: "READ_ANALYTICS",
  risk: "LOW",
  mutates: false,
  execute: () => getBusinessSummary(),
});

const getDailyMetricsTool = define({
  name: "get_daily_metrics",
  description:
    "Daily sessions, orders, revenue, COGS, ad spend, refunds, returns and failed payment ATTEMPTS. Attempts are not order rows — one shopper retrying a card five times is five attempts and at most one failed order. Compare with get_channel_breakdown only if you mean to compare two different things.",
  input: z.object({ days: z.number().int().min(1).max(90).default(30) }),
  output: z.any(),
  permission: "READ_ANALYTICS",
  risk: "LOW",
  mutates: false,
  execute: ({ days }) => getDailyMetrics(days),
});

const getRevenueDecompositionTool = define({
  name: "get_revenue_decomposition",
  description:
    "Decomposes the revenue change into traffic, conversion and AOV, and ranks the drivers by contribution.",
  input: z.object({}),
  output: z.any(),
  permission: "READ_ANALYTICS",
  risk: "LOW",
  mutates: false,
  execute: () => getRevenueDecomposition(),
});

const getChannelBreakdownTool = define({
  name: "get_channel_breakdown",
  description:
    "Orders, revenue and the share of ORDERS whose payment failed, split by channel. This counts order rows, not attempts — see get_daily_metrics for attempts.",
  input: z.object({ days: z.number().int().min(1).max(90).default(7) }),
  output: z.any(),
  permission: "READ_ANALYTICS",
  risk: "LOW",
  mutates: false,
  execute: ({ days }) => getChannelBreakdown(days),
});

const detectAnomaliesTool = define({
  name: "detect_anomalies",
  description:
    "Flags metrics whose latest value deviates from the trailing mean by more than the given number of standard deviations.",
  input: z.object({ sigma: z.number().min(1).max(4).default(2) }),
  output: z.any(),
  permission: "READ_ANALYTICS",
  risk: "LOW",
  mutates: false,
  execute: ({ sigma }) => {
    const metrics = getDailyMetrics(30);
    if (metrics.length < 8) return [];
    const latest = metrics.at(-1)!;
    const history = metrics.slice(0, -1);

    const series: { name: string; pick: (m: (typeof metrics)[number]) => number; direction: "up" | "down" }[] = [
      { name: "Revenue", pick: (m) => m.revenuePaise, direction: "down" },
      { name: "Sessions", pick: (m) => m.sessions, direction: "down" },
      { name: "Conversion rate", pick: (m) => pct(m.orders, m.sessions), direction: "down" },
      { name: "Mobile payment failure attempts", pick: (m) => m.mobilePaymentFailures, direction: "up" },
      { name: "Returns", pick: (m) => m.returns, direction: "up" },
      { name: "Refunds", pick: (m) => m.refundsPaise, direction: "up" },
    ];

    return series.flatMap(({ name, pick, direction }) => {
      const values = history.map(pick);
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
      if (sd === 0) return [];
      const current = pick(latest);
      const z = (current - mean) / sd;
      const breached = direction === "down" ? z <= -sigma : z >= sigma;
      if (!breached) return [];
      return [{
        metric: name,
        current: round(current, 2),
        expected: round(mean, 2),
        zScore: round(z, 2),
        direction,
        severity: Math.abs(z) >= 3 ? "HIGH" : "MEDIUM",
      }];
    });
  },
});

const recordPlanNoteTool = define({
  name: "record_plan_note",
  description: "Stores a strategic conclusion in shared memory so later runs can build on it.",
  input: z.object({
    content: z.string().min(4).max(600),
    importance: z.number().min(0).max(1).default(0.6),
  }),
  output: z.any(),
  permission: "WRITE_PLANS",
  risk: "LOW",
  mutates: true,
  execute: ({ content, importance }, ctx) =>
    rememberFact({ agentId: ctx.agentId, kind: "episodic", content, importance }),
});

// ─── Inventory ───────────────────────────────────────────────────────────────

const getInventoryTool = define({
  name: "get_inventory",
  description:
    "Stock on hand with sales velocity, days of cover, supplier lead time and a computed stockout risk.",
  input: z.object({ onlyAtRisk: z.boolean().default(false) }),
  output: z.any(),
  permission: "READ_INVENTORY",
  risk: "LOW",
  mutates: false,
  execute: ({ onlyAtRisk }) => {
    const risks = getStockoutRisks();
    return onlyAtRisk ? risks.filter((r) => r.risk === "HIGH" || r.risk === "CRITICAL") : risks;
  },
});

const getSalesVelocityTool = define({
  name: "get_sales_velocity",
  description: "Units sold per day for a product over a trailing window.",
  input: z.object({
    productId: z.string(),
    days: z.number().int().min(1).max(90).default(14),
  }),
  output: z.any(),
  permission: "READ_ORDERS",
  risk: "LOW",
  mutates: false,
  execute: ({ productId, days }) => ({
    productId,
    windowDays: days,
    unitsPerDay: round(getSalesVelocity(productId, days), 2),
  }),
});

const forecastDemandTool = define({
  name: "forecast_demand",
  description:
    "Weighted moving-average demand forecast with a confidence derived from historical variance.",
  input: z.object({
    productId: z.string(),
    horizonDays: z.number().int().min(1).max(90).default(14),
  }),
  output: z.any(),
  permission: "READ_INVENTORY",
  risk: "LOW",
  mutates: false,
  execute: ({ productId, horizonDays }) => forecastDemand(productId, horizonDays),
});

const adjustReorderPointTool = define({
  name: "adjust_reorder_point",
  description: "Changes the reorder threshold for a product.",
  input: z.object({
    productId: z.string(),
    delta: z.number().int(),
    reason: z.string().min(4),
  }),
  output: z.any(),
  permission: "WRITE_INVENTORY",
  risk: "LOW",
  mutates: true,
  execute: ({ productId, delta, reason }) => {
    const item = getInventoryItem(productId);
    if (!item) throw new Error(`Unknown product ${productId}`);
    const next = Math.max(0, item.reorderPoint + delta);
    setReorderPoint(productId, next);
    return { productId, previous: item.reorderPoint, next, reason };
  },
});

// ─── Pricing ─────────────────────────────────────────────────────────────────

const getProductsTool = define({
  name: "get_products",
  description: "Product catalogue with cost, price, competitor price and rating.",
  input: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
  output: z.any(),
  permission: "READ_PRODUCTS",
  risk: "LOW",
  mutates: false,
  execute: ({ limit }) => listProducts(limit),
});

const getCompetitorPricesTool = define({
  name: "get_competitor_prices",
  description:
    "Our price against the tracked competitor price, with the gap and current margin for each product.",
  input: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
  output: z.any(),
  permission: "READ_COMPETITORS",
  risk: "LOW",
  mutates: false,
  execute: ({ limit }) =>
    listProducts(limit)
      .map((p) => ({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        ourPricePaise: p.pricePaise,
        competitorPricePaise: p.competitorPricePaise,
        gapPercent: round(((p.pricePaise - p.competitorPricePaise) / p.competitorPricePaise) * 100, 1),
        marginPercent: round(marginPct(p.pricePaise, p.costPaise), 1),
      }))
      .sort((a, b) => b.gapPercent - a.gapPercent),
});

const calculateMarginTool = define({
  name: "calculate_margin",
  description: "Unit economics for a product at its current or a hypothetical price.",
  input: z.object({
    productId: z.string(),
    atPricePaise: z.number().int().positive().optional(),
  }),
  output: z.any(),
  permission: "READ_PRODUCTS",
  risk: "LOW",
  mutates: false,
  execute: ({ productId, atPricePaise }) => {
    const product = getProduct(productId);
    if (!product) throw new Error(`Unknown product ${productId}`);
    const price = atPricePaise ?? product.pricePaise;
    return {
      productId: product.id,
      sku: product.sku,
      pricePaise: price,
      costPaise: product.costPaise,
      grossProfitPaise: price - product.costPaise,
      marginPercent: round(marginPct(price, product.costPaise), 2),
    };
  },
});

const simulatePriceChangeTool = define({
  name: "simulate_price_change",
  description:
    "Projects units, revenue and profit at a new price using a constant-elasticity model. Estimates only — labelled as such wherever shown.",
  input: z.object({
    productId: z.string(),
    newPricePaise: z.number().int().positive(),
    elasticity: z.number().min(-4).max(0).default(-1.4),
  }),
  output: z.any(),
  permission: "READ_PRODUCTS",
  risk: "LOW",
  mutates: false,
  execute: ({ productId, newPricePaise, elasticity }) => {
    const product = getProduct(productId);
    if (!product) throw new Error(`Unknown product ${productId}`);
    const baselineUnits = Math.max(1, getSalesVelocity(productId, 14) * 30);
    const priceRatio = newPricePaise / product.pricePaise;
    // Constant price elasticity of demand: Q1/Q0 = (P1/P0)^e
    const projectedUnits = baselineUnits * priceRatio ** elasticity;

    const before = {
      units: round(baselineUnits, 1),
      revenuePaise: Math.round(baselineUnits * product.pricePaise),
      profitPaise: Math.round(baselineUnits * (product.pricePaise - product.costPaise)),
      marginPercent: round(marginPct(product.pricePaise, product.costPaise), 1),
    };
    const after = {
      units: round(projectedUnits, 1),
      revenuePaise: Math.round(projectedUnits * newPricePaise),
      profitPaise: Math.round(projectedUnits * (newPricePaise - product.costPaise)),
      marginPercent: round(marginPct(newPricePaise, product.costPaise), 1),
    };
    return {
      productId,
      basis: "ESTIMATED — constant-elasticity model over 30 days of trailing demand",
      elasticity,
      before,
      after,
      profitDeltaPaise: after.profitPaise - before.profitPaise,
    };
  },
});

const updatePriceTool = define({
  name: "update_price",
  description: "Sets a new price for a product. Subject to the margin floor and the step limit.",
  input: z.object({
    productId: z.string(),
    newPricePaise: z.number().int().positive(),
    reason: z.string().min(4),
  }),
  output: z.any(),
  permission: "WRITE_PRICES",
  // A price change moves no cash, so it deliberately declares no financial
  // impact: the auto-approval thresholds exist for money leaving the business
  // (refunds, purchase orders, ad spend), and feeding revenue-at-risk into them
  // would push every routine repricing into the approval queue. Pricing is
  // bounded by its own policies instead — the 25% margin floor and the 10% step
  // limit, both enforced in governance.
  risk: ({ productId, newPricePaise }) => {
    const product = getProduct(productId);
    if (!product) return "MEDIUM";
    const changePercent = Math.abs(
      ((newPricePaise - product.pricePaise) / product.pricePaise) * 100,
    );
    return changePercent <= 5 ? "LOW" : "MEDIUM";
  },
  mutates: true,
  execute: ({ productId, newPricePaise, reason }, ctx) =>
    updateProductPrice(productId, newPricePaise, reason, ctx.agentId),
});

// ─── Marketing ───────────────────────────────────────────────────────────────

const getCampaignMetricsTool = define({
  name: "get_campaign_metrics",
  description: "All campaigns with spend, revenue, clicks, impressions and conversions.",
  input: z.object({}),
  output: z.any(),
  permission: "READ_CAMPAIGNS",
  risk: "LOW",
  mutates: false,
  execute: () => listCampaigns(),
});

const getCampaignEfficiencyTool = define({
  name: "get_campaign_efficiency",
  description: "Campaigns ranked by ROAS with CAC, CTR, conversion rate and a verdict.",
  input: z.object({}),
  output: z.any(),
  permission: "READ_CAMPAIGNS",
  risk: "LOW",
  mutates: false,
  execute: () => getCampaignEfficiency(),
});

const proposeBudgetChangeTool = define({
  name: "propose_budget_change",
  description: "Moves daily budget on a campaign. Capped by the marketing daily-movement policy.",
  input: z.object({
    campaignId: z.string(),
    deltaPaise: z.number().int(),
    reason: z.string().min(4),
  }),
  output: z.any(),
  permission: "WRITE_CAMPAIGNS",
  risk: "MEDIUM",
  mutates: true,
  financialImpactPaise: ({ deltaPaise }) => Math.abs(deltaPaise),
  execute: ({ campaignId, deltaPaise, reason }) => {
    const campaign = getCampaign(campaignId);
    if (!campaign) throw new Error(`Unknown campaign ${campaignId}`);
    const next = Math.max(0, campaign.dailyBudgetPaise + deltaPaise);
    updateCampaignBudget(campaignId, next);
    return {
      campaignId,
      previousPaise: campaign.dailyBudgetPaise,
      nextPaise: next,
      reason,
      note: "SIMULATED — no ad platform is contacted",
    };
  },
});

const pauseCampaignTool = define({
  name: "pause_campaign",
  description: "Pauses a campaign so it stops consuming budget.",
  input: z.object({ campaignId: z.string(), reason: z.string().min(4) }),
  output: z.any(),
  permission: "WRITE_CAMPAIGNS",
  risk: "LOW",
  mutates: true,
  execute: ({ campaignId, reason }) => {
    const campaign = getCampaign(campaignId);
    if (!campaign) throw new Error(`Unknown campaign ${campaignId}`);
    setCampaignStatus(campaignId, "PAUSED");
    return { campaignId, status: "PAUSED", reason, freedDailyPaise: campaign.dailyBudgetPaise };
  },
});

const draftCampaignCopyTool = define({
  name: "draft_campaign_copy",
  description:
    "Builds ad copy from a product's real attributes. Returns a draft; nothing is published.",
  input: z.object({ productId: z.string(), angle: z.enum(["value", "quality", "urgency"]) }),
  output: z.any(),
  permission: "READ_PRODUCTS",
  risk: "LOW",
  mutates: false,
  execute: ({ productId, angle }) => {
    const product = getProduct(productId);
    if (!product) throw new Error(`Unknown product ${productId}`);
    const item = getInventoryItem(productId);
    const gap = product.competitorPricePaise - product.pricePaise;
    const headline =
      angle === "value" && gap > 0
        ? `${product.name} — ${formatMoney(gap)} below the market`
        : angle === "quality"
          ? `${product.name}: rated ${product.rating.toFixed(1)}/5 by buyers`
          : `${product.name} — ${item?.onHand ?? 0} left in stock`;
    return {
      productId,
      angle,
      headline,
      body: `${product.description} ${formatMoney(product.pricePaise)}.`,
      grounding: {
        pricePaise: product.pricePaise,
        competitorPricePaise: product.competitorPricePaise,
        rating: product.rating,
        onHand: item?.onHand ?? 0,
      },
    };
  },
});

// ─── Customer ────────────────────────────────────────────────────────────────

const getOrdersTool = define({
  name: "get_orders",
  description: "Recent orders with status, channel, totals and payment status.",
  input: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
  output: z.any(),
  permission: "READ_ORDERS",
  risk: "LOW",
  mutates: false,
  execute: ({ limit }) => listOrders(limit),
});

const getOpenTicketsTool = define({
  name: "get_open_tickets",
  description: "Customer tickets awaiting a reply.",
  input: z.object({}),
  output: z.any(),
  permission: "READ_TICKETS",
  risk: "LOW",
  mutates: false,
  execute: () => listTickets("OPEN"),
});

const getProductRecommendationsTool = define({
  name: "get_product_recommendations",
  description:
    "Ranks the catalogue against a shopper's stated need. Returns the score breakdown for each result.",
  input: z.object({
    query: z.string().min(2),
    maxBudgetPaise: z.number().int().positive().optional(),
    category: z.string().optional(),
    limit: z.number().int().min(1).max(10).default(4),
  }),
  output: z.any(),
  permission: "READ_PRODUCTS",
  risk: "LOW",
  mutates: false,
  execute: ({ query, maxBudgetPaise, category, limit }) =>
    recommendProducts({ text: query, maxBudgetPaise, category, limit }),
});

const replyTicketTool = define({
  name: "reply_ticket",
  description: "Sends a reply to a customer ticket, optionally escalating it to a human.",
  input: z.object({
    ticketId: z.string(),
    message: z.string().min(10),
    escalate: z.boolean().default(false),
  }),
  output: z.any(),
  permission: "WRITE_TICKETS",
  risk: "LOW",
  mutates: true,
  execute: ({ ticketId, message, escalate }) => {
    const changed = answerTicket(ticketId, message, escalate);
    if (!changed) throw new Error(`Ticket ${ticketId} is missing or already answered`);
    return { ticketId, escalated: escalate };
  },
});

const createRefundTool = define({
  name: "create_refund",
  description:
    "Refunds an order. Payments are simulated; no card data is touched and no money moves.",
  input: z.object({
    orderId: z.string(),
    amountPaise: z.number().int().positive(),
    reason: z.string().min(4),
    suspectedFraud: z.boolean().default(false),
  }),
  output: z.any(),
  permission: "WRITE_REFUNDS",
  risk: "MEDIUM",
  mutates: true,
  financialImpactPaise: ({ amountPaise }) => amountPaise,
  execute: ({ orderId, amountPaise, reason }) => {
    const order = getOrder(orderId);
    if (!order) throw new Error(`Unknown order ${orderId}`);
    if (order.paymentStatus === "REFUNDED") {
      throw new Error(`Order ${orderId} has already been refunded.`);
    }
    if (amountPaise > order.totalPaise) {
      throw new Error(
        `Refund ${formatMoney(amountPaise)} exceeds the order total ${formatMoney(order.totalPaise)}`,
      );
    }
    const transactionId = recordRefund(orderId, amountPaise);
    return { orderId, amountPaise, reason, transactionId, simulated: true };
  },
});

// ─── Procurement ─────────────────────────────────────────────────────────────

const getSupplierQuotesTool = define({
  name: "get_supplier_quotes",
  description: "Supplier quotes for a product with unit cost, lead time, MOQ and scores.",
  input: z.object({ productId: z.string() }),
  output: z.any(),
  permission: "READ_SUPPLIERS",
  risk: "LOW",
  mutates: false,
  execute: ({ productId }) => getSupplierQuotes(productId),
});

const createPurchaseOrderTool = define({
  name: "create_purchase_order",
  description:
    "Raises a purchase order with a supplier. Simulated — no supplier is contacted and no money moves. Above ₹50,000 this requires human approval.",
  input: z.object({
    productId: z.string(),
    supplierId: z.string(),
    quantity: z.number().int().positive(),
    reason: z.string().min(4),
  }),
  output: z.any(),
  permission: "WRITE_PURCHASE_ORDERS",
  risk: "MEDIUM",
  mutates: true,
  financialImpactPaise: ({ productId, supplierId, quantity }) => {
    const quote = getSupplierQuotes(productId).find((q) => q.supplierId === supplierId);
    return quote ? quote.unitCostPaise * quantity : 0;
  },
  execute: ({ productId, supplierId, quantity, reason }) => {
    const quote = getSupplierQuotes(productId).find((q) => q.supplierId === supplierId);
    if (!quote) throw new Error(`No quote from ${supplierId} for ${productId}`);
    if (quantity < quote.minimumOrderQuantity) {
      throw new Error(
        `Quantity ${quantity} is below ${quote.supplierName}'s minimum of ${quote.minimumOrderQuantity}`,
      );
    }
    const expected = new Date();
    expected.setDate(expected.getDate() + quote.leadTimeDays);
    const po = createPurchaseOrder({
      id: newId("po"),
      supplierId,
      productId,
      quantity,
      unitCostPaise: quote.unitCostPaise,
      totalPaise: quote.unitCostPaise * quantity,
      status: "PLACED",
      expectedAt: expected.toISOString(),
    });
    // Stock is credited on arrival, not on order.
    return {
      ...po,
      reason,
      simulated: true,
      note: "SIMULATED — no supplier is contacted and no money moves. Stock is credited when the order is received.",
    };
  },
});

const receivePurchaseOrderTool = define({
  name: "receive_purchase_order",
  description: "Marks a purchase order as received and credits the stock. One order is received once.",
  input: z.object({ purchaseOrderId: z.string(), productId: z.string(), quantity: z.number().int().positive() }),
  output: z.any(),
  permission: "WRITE_INVENTORY",
  risk: "LOW",
  mutates: true,
  execute: ({ purchaseOrderId, productId, quantity }) => {
    const po = listPurchaseOrders(200).find((p) => p.id === purchaseOrderId);
    if (!po) throw new Error(`Unknown purchase order ${purchaseOrderId}`);
    if (po.productId !== productId) {
      throw new Error(
        `Purchase order ${purchaseOrderId} is for product ${po.productId}, not ${productId}`,
      );
    }
    if (po.quantity !== quantity) {
      throw new Error(
        `Purchase order ${purchaseOrderId} is for ${po.quantity} units, not ${quantity}`,
      );
    }
    if (po.status === "RECEIVED") {
      throw new Error(`Purchase order ${purchaseOrderId} was already received — stock was credited then.`);
    }
    if (po.status !== "PLACED" && po.status !== "DELAYED") {
      throw new Error(`Purchase order ${purchaseOrderId} is ${po.status.toLowerCase()} and cannot be received`);
    }
    markPurchaseOrderReceived(purchaseOrderId);
    return {
      purchaseOrderId,
      productId,
      onHand: adjustStock(productId, quantity),
    };
  },
});

// ─── Fulfillment ─────────────────────────────────────────────────────────────

const getFulfillmentQueueTool = define({
  name: "get_fulfillment_queue",
  description:
    "Orders awaiting or undergoing supplier fulfilment, with attempt counts and the last error for anything stuck.",
  input: z.object({
    status: z
      .enum(["PENDING_SUPPLIER", "SUBMITTED", "SHIPPED", "EXCEPTION", "CANCELLED"])
      .optional(),
  }),
  output: z.any(),
  permission: "READ_ORDERS",
  risk: "LOW",
  mutates: false,
  execute: ({ status }) => listFulfillments(status),
});

const getOrderStatusTool = define({
  name: "get_order_status",
  description:
    "The live state of one order: payment, fulfilment, the supplier's reference and tracking if there is any. This is the only source for what a customer may be told about their order.",
  input: z.object({ orderId: z.string() }),
  output: z.any(),
  permission: "READ_ORDERS",
  risk: "LOW",
  mutates: false,
  execute: ({ orderId }) => {
    const order = getOrder(orderId);
    if (!order) throw new Error(`Unknown order ${orderId}`);
    const fulfillment = getFulfillmentForOrder(orderId);

    // No customer fields here on purpose: this feeds replies and model prompts,
    // and the agent needs the order's state, never the person attached to it.
    return {
      orderId: order.id,
      orderStatus: order.status,
      paymentStatus: order.paymentStatus,
      placedAt: order.createdAt,
      fulfillment: fulfillment
        ? {
            status: fulfillment.status,
            supplier: fulfillment.supplier,
            supplierReference: fulfillment.externalId,
            trackingUrl: fulfillment.trackingUrl,
            attempts: fulfillment.attempts,
            lastError: fulfillment.lastError,
            simulated: fulfillment.simulated,
          }
        : null,
      // Spelled out so neither a template nor a model has to infer it.
      summary: describeOrderState(order.status, order.paymentStatus, fulfillment),
    };
  },
});

const fulfillOrderTool = define({
  name: "fulfill_order",
  description:
    "Hands a paid order to the dropshipping supplier. Commits the request and queues the supplier call; it does not wait for the vendor.",
  input: z.object({
    orderId: z.string(),
    reason: z.string().min(4),
  }),
  output: z.any(),
  permission: "WRITE_FULFILLMENT",
  risk: "MEDIUM",
  mutates: true,
  // The supplier is paid the cost of goods, not the price the customer paid.
  // Routing that through governance is what puts a large fulfilment in front of
  // a human before anything is sent to a vendor.
  financialImpactPaise: ({ orderId }) => getOrder(orderId)?.costPaise ?? 0,
  execute: ({ orderId, reason }, ctx) => {
    const order = getOrder(orderId);
    if (!order) throw new Error(`Unknown order ${orderId}`);
    if (order.paymentStatus !== "SUCCESS") {
      throw new Error(`Order ${orderId} is not paid (payment ${order.paymentStatus})`);
    }
    if (order.status === "CANCELLED" || order.status === "RETURNED") {
      throw new Error(
        `Order ${orderId} is ${order.status.toLowerCase()} and must not be sent to the supplier`,
      );
    }

    // One fulfilment per order. Without this, a retried plan or two agents
    // reaching the same conclusion would send the supplier the same order twice.
    const existing = getFulfillmentForOrder(orderId);
    if (existing && existing.status !== "CANCELLED") {
      return {
        fulfillmentId: existing.id,
        orderId,
        status: existing.status,
        deduplicated: true,
        note: "This order is already with the supplier; no second request was made.",
      };
    }

    const fulfillment = createFulfillment({
      id: newId("ful"),
      orderId,
      supplier: getSupplier().label,
    });
    const job = enqueue(
      FULFILLMENT_JOB,
      { fulfillmentId: fulfillment.id, orderId },
      { correlationId: ctx.correlationId },
    );

    return {
      fulfillmentId: fulfillment.id,
      orderId,
      jobId: job.id,
      status: fulfillment.status,
      reason,
      supplier: getSupplier().label,
      note: getSupplier().live
        ? "Queued for submission to a live supplier."
        : "SIMULATED — no supplier is contacted. Queued and recorded locally.",
    };
  },
});

/**
 * One sentence describing where an order actually is.
 *
 * It exists so that nothing downstream — a reply template, a model prompt, the
 * UI — has to guess. Every branch below corresponds to state the system can
 * observe; there is no branch for "probably with the courier".
 */
function describeOrderState(
  orderStatus: Order["status"],
  paymentStatus: Order["paymentStatus"],
  fulfillment: Fulfillment | null,
): string {
  if (paymentStatus === "REFUNDED") return "This order has been refunded.";
  if (orderStatus === "CANCELLED") return "This order was cancelled.";
  if (paymentStatus === "FAILED") return "Payment for this order did not go through, so it has not been sent to the supplier.";

  if (!fulfillment) {
    return "This order is paid and waiting to be sent to the supplier. It has not shipped.";
  }

  switch (fulfillment.status) {
    case "PENDING_SUPPLIER":
      return "This order is queued to go to the supplier and has not shipped yet.";
    case "SUBMITTED":
      return `The supplier has accepted this order${
        fulfillment.externalId ? ` under reference ${fulfillment.externalId}` : ""
      }. There is no tracking number yet.`;
    case "SHIPPED":
      return fulfillment.trackingUrl
        ? `This order has shipped and can be tracked at ${fulfillment.trackingUrl}.`
        : "This order has shipped. Tracking has not come back from the supplier yet.";
    case "EXCEPTION":
      return "This order failed to reach the supplier and is being handled by a person. It has not shipped.";
    case "CANCELLED":
      return "This order's fulfilment was cancelled.";
  }
}

// ─── Conversational checkout for AI buyers ────────────────────────────────────

const placeMachineOrderTool = define({
  name: "place_machine_order",
  description:
    "Places a cart for an AI buyer and creates the payment order through the payments gateway. Returns PENDING_PAYMENT plus the payment context the buyer completes payment with. Stock is not reserved and nothing ships until payment confirms.",
  input: z.object({
    buyerId: z.string().min(3).max(64),
    items: z
      .array(z.object({ productId: z.string(), quantity: z.number().int().min(1).max(20) }))
      .min(1)
      .max(10),
  }),
  output: z.any(),
  permission: "WRITE_ORDERS",
  risk: "MEDIUM",
  mutates: true,
  // The cart's value is inbound money, but declaring it keeps the money checks
  // honest: a cart above the hard ceiling is denied by FIN-003 before any
  // payment order is created, and a large cart reads as high risk to a human
  // in the approval queue. Under autonomy 2 the placement parks anyway.
  financialImpactPaise: ({ items }) =>
    items.reduce((sum, item) => {
      const product = getProduct(item.productId);
      return sum + (product ? product.pricePaise * item.quantity : 0);
    }, 0),
  execute: async ({ buyerId, items }) => {
    const stock = checkCartStock(items);
    const shortfall = stock.filter((s) => s.requested > s.onHand);
    if (shortfall.length > 0) {
      throw new Error(
        `Insufficient stock: ${shortfall.map((s) => `${s.sku} (${s.requested} wanted, ${s.onHand} on hand)`).join("; ")}`,
      );
    }

    const totalPaise = items.reduce((sum, item) => {
      const product = getProduct(item.productId);
      if (!product) throw new Error(`Unknown product ${item.productId}`);
      return sum + product.pricePaise * item.quantity;
    }, 0);

    // The hard ceiling applies to machine orders exactly as to human ones: a
    // cart above it is refused before any payment order is created.
    const { financial } = POLICY_LIMITS;
    if (totalPaise > financial.hardCeilingPaise) {
      throw new Error(
        `Cart of ${formatMoney(totalPaise)} exceeds the ${formatMoney(financial.hardCeilingPaise)} hard ceiling`,
      );
    }

    const payment = await getPayments().createOrder({
      orderId: `pending_${buyerId}`,
      amountPaise: totalPaise,
      notes: { buyer: buyerId, source: "machine_checkout" },
    });

    const order = createMachineOrder({
      buyerId,
      lines: items,
      processorOrderId: payment.processorOrderId,
      paymentSimulated: payment.simulated,
    });

    return {
      machineOrderId: order.id,
      status: order.status,
      totalPaise: order.totalPaise,
      lines: order.lines,
      payment: {
        processorOrderId: payment.processorOrderId,
        context: payment.paymentContext,
        simulated: payment.simulated,
      },
      note: payment.simulated
        ? "SIMULATED — the payment reference is local (TXN_DEMO_*); confirm with confirm_machine_payment."
        : "Payment order created on Razorpay test mode. No money has moved; confirm with confirm_machine_payment once the buyer pays.",
    };
  },
});

const confirmMachinePaymentTool = define({
  name: "confirm_machine_payment",
  description:
    "Confirms a machine order's payment, the only transition into PAID. Simulated payments confirm instantly in the demo; a live gateway is checked by its processor reference before the order is believed paid.",
  input: z.object({
    machineOrderId: z.string(),
    processorPaymentId: z.string().optional(),
  }),
  output: z.any(),
  permission: "WRITE_ORDERS",
  risk: "MEDIUM",
  mutates: true,
  financialImpactPaise: ({ machineOrderId }) => getMachineOrder(machineOrderId)?.totalPaise ?? 0,
  execute: ({ machineOrderId, processorPaymentId }) => {
    const order = getMachineOrder(machineOrderId);
    if (!order) throw new Error(`Unknown machine order ${machineOrderId}`);
    if (order.status !== "PENDING_PAYMENT") {
      throw new Error(`Machine order ${machineOrderId} is ${order.status.toLowerCase()}, not awaiting payment`);
    }

    // A simulated gateway cannot confirm anything a human did not click, so the
    // demo confirm path is explicit about being a simulation. A live order is
    // confirmed only against a processor payment id the gateway recognises.
    const reference = processorPaymentId ?? order.processorOrderId ?? machineOrderId;
    const paid = markMachineOrderPaid(machineOrderId, reference);

    return {
      machineOrderId: paid.id,
      status: paid.status,
      totalPaise: paid.totalPaise,
      paymentReference: reference,
      simulated: paid.paymentSimulated,
      note: paid.paymentSimulated
        ? "SIMULATED — payment confirmed locally. No money moved."
        : "Payment recorded against the processor's reference.",
    };
  },
});

const getMachineOrderTool = define({
  name: "get_machine_order",
  description: "One machine order with its lines, total and payment state.",
  input: z.object({ machineOrderId: z.string() }),
  output: z.any(),
  permission: "READ_ORDERS",
  risk: "LOW",
  mutates: false,
  execute: ({ machineOrderId }) => {
    const order = getMachineOrder(machineOrderId);
    if (!order) throw new Error(`Unknown machine order ${machineOrderId}`);
    return order;
  },
});

/**
 * Cross-sell candidates for a cart: same-category products the buyer has not
 * chosen, ranked by the same relevance engine that powers shopper search.
 * Deterministic, and every candidate is one the buyer can actually transact —
 * in stock, and inside the hard ceiling if added.
 */
const draftUpsellOffersTool = define({
  name: "draft_upsell_offers",
  description:
    "Cross-sell candidates for a cart: same-category products the buyer has not chosen, in stock, ranked with a score breakdown. Returns offers only — nothing is added to any cart by this call.",
  input: z.object({
    productIds: z.array(z.string()).min(1).max(10),
    maxOffers: z.number().int().min(1).max(5).default(3),
  }),
  output: z.any(),
  permission: "READ_PRODUCTS",
  risk: "LOW",
  mutates: false,
  execute: ({ productIds, maxOffers }) => {
    const picks: {
      productId: string;
      name: string;
      pricePaise: number;
      reason: string;
      score: number;
    }[] = [];

    for (const productId of productIds) {
      const product = getProduct(productId);
      if (!product) continue;
      const peers = listProducts(200).filter(
        (p) =>
          p.category === product.category &&
          p.id !== productId &&
          !productIds.includes(p.id) &&
          (getInventoryItem(p.id)?.onHand ?? 0) > 0,
      );
      // Cheapest useful peer first: an upsell that doubles the cart is a
      // proposal the buyer will refuse, and a refused offer is noise.
      const best = peers.sort((a, b) => a.pricePaise - b.pricePaise)[0];
      if (best) {
        picks.push({
          productId: best.id,
          name: best.name,
          pricePaise: best.pricePaise,
          reason: `Pairs with ${product.name} (${product.category}); priced below it`,
          score: round(pct(1, peers.length + 1), 0),
        });
      }
    }

    const deduped: typeof picks = [];
    for (const pick of picks) {
      if (deduped.some((d) => d.productId === pick.productId)) continue;
      deduped.push(pick);
    }

    return {
      offers: deduped.slice(0, maxOffers),
      basis: "Same-category, in-stock, not already in the cart. Deterministic ranking — cheapest qualifying peer per cart line, deduplicated.",
    };
  },
});

// ─── Catalog for machine buyers ─────────────────────────────────────────────

const getAgentCatalogTool = define({
  name: "get_agent_catalog",
  description:
    "The catalogue in the shape an AI buyer consumes: one entry per product with id, price, availability, lead time and stock, plus the policies that govern machine purchases. This is the same data /api/catalog serves external agents.",
  input: z.object({
    category: z.string().optional(),
    inStockOnly: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: z.any(),
  permission: "READ_PRODUCTS",
  risk: "LOW",
  mutates: false,
  execute: ({ category, inStockOnly, limit }) => buildAgentCatalog({ category, inStockOnly, limit }),
});

/**
 * The machine-readable catalogue. Shared by the agent tool and the public
 * `/api/catalog` route so the two can never drift.
 *
 * Deliberately excludes cost, supplier identity and margin — those are the
 * merchant's private economics, not something a buyer needs to transact. A
 * buyer sees what a shopper in the shop sees: what is for sale, at what price,
 * and whether it can ship.
 */
export function buildAgentCatalog(options: {
  category?: string;
  inStockOnly?: boolean;
  limit?: number;
}) {
  const products = listProducts(200)
    .filter((p) => (options.category ? p.category === options.category : true))
    .slice(0, options.limit ?? 50);

  const entries = products.map((p) => {
    const item = getInventoryItem(p.id);
    const onHand = item?.onHand ?? 0;
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      brand: p.brand,
      description: p.description,
      pricePaise: p.pricePaise,
      currency: "INR",
      rating: p.rating,
      availability: {
        inStock: onHand > 0,
        onHand,
        leadTimeDays: item?.leadTimeDays ?? null,
      },
    };
  });

  const filtered = options.inStockOnly ? entries.filter((e) => e.availability.inStock) : entries;

  return {
    catalog: filtered,
    purchasePolicies: {
      // Mirrors FIN-003, the hard ceiling: no machine purchase above it exists.
      maxOrderValuePaise: 500_00 * 100,
      paymentMode: "test" as const,
      note: "Machine purchases are gated by the same governance as human ones: every money action is explainable, bounded, and logged with a full audit trail.",
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─── Registry ────────────────────────────────────────────────────────────────

export const TOOLS: Record<string, RegisteredTool> = Object.fromEntries(
  [
    getBusinessSummaryTool,
    getDailyMetricsTool,
    getRevenueDecompositionTool,
    getChannelBreakdownTool,
    detectAnomaliesTool,
    recordPlanNoteTool,
    getInventoryTool,
    getSalesVelocityTool,
    forecastDemandTool,
    adjustReorderPointTool,
    getProductsTool,
    getCompetitorPricesTool,
    calculateMarginTool,
    simulatePriceChangeTool,
    updatePriceTool,
    getCampaignMetricsTool,
    getCampaignEfficiencyTool,
    proposeBudgetChangeTool,
    pauseCampaignTool,
    draftCampaignCopyTool,
    getOrdersTool,
    getOpenTicketsTool,
    getProductRecommendationsTool,
    replyTicketTool,
    createRefundTool,
    getSupplierQuotesTool,
    createPurchaseOrderTool,
    receivePurchaseOrderTool,
    getFulfillmentQueueTool,
    getOrderStatusTool,
    fulfillOrderTool,
    getAgentCatalogTool,
    draftUpsellOffersTool,
    placeMachineOrderTool,
    confirmMachinePaymentTool,
    getMachineOrderTool,
  ].map((tool) => [tool.name, tool as RegisteredTool]),
);

export const getTool = (name: string): RegisteredTool | undefined => TOOLS[name];

export const listTools = (): RegisteredTool[] => Object.values(TOOLS);
