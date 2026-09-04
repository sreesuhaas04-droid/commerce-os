/**
 * Read/write helpers over the commerce tables.
 *
 * Everything here is deterministic SQL + arithmetic. No agent and no model
 * touches these directly — tools do, and tools are the only thing agents can
 * call. Keeping the maths in one place is what makes the numbers on screen
 * trustworthy regardless of which reasoning engine is active.
 */
import { fromJson, getDb, num, str, toJson } from "./db";
import type {
  AgentId,
  Approval,
  AuditEntry,
  BusinessGoal,
  Campaign,
  Customer,
  DailyMetric,
  Fulfillment,
  FulfillmentStatus,
  InventoryItem,
  MemoryRecord,
  Order,
  Product,
  PurchaseOrder,
  Supplier,
  SupplierQuote,
  Ticket,
} from "@/types";
import { changePct, marginPct, pct } from "@/lib/money";

// ─── Products ────────────────────────────────────────────────────────────────

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  brand: string;
  description: string;
  cost_paise: number;
  price_paise: number;
  competitor_price_paise: number;
  rating: number;
  created_at: string;
};

const mapProduct = (r: ProductRow): Product => ({
  id: r.id,
  sku: r.sku,
  name: r.name,
  category: r.category,
  brand: r.brand,
  description: r.description,
  costPaise: num(r.cost_paise),
  pricePaise: num(r.price_paise),
  competitorPricePaise: num(r.competitor_price_paise),
  rating: num(r.rating),
  createdAt: r.created_at,
});

export function listProducts(limit = 200): Product[] {
  return getDb()
    .all<ProductRow>(`SELECT * FROM products ORDER BY sku LIMIT ?`, limit)
    .map(mapProduct);
}

export function getProduct(idOrSku: string): Product | null {
  const row = getDb().get<ProductRow>(
    `SELECT * FROM products WHERE id = ? OR sku = ?`,
    idOrSku,
    idOrSku,
  );
  return row ? mapProduct(row) : null;
}

export function updateProductPrice(
  productId: string,
  newPricePaise: number,
  reason: string,
  agentId: string,
): { oldPricePaise: number; newPricePaise: number } {
  const db = getDb();
  return db.transaction(() => {
    const product = getProduct(productId);
    if (!product) throw new Error(`Unknown product ${productId}`);
    db.run(`UPDATE products SET price_paise = ? WHERE id = ?`, newPricePaise, product.id);
    db.run(
      `INSERT INTO pricing_history (id, product_id, old_price_paise, new_price_paise, reason, agent_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      `prh_${product.id}_${Date.now()}`,
      product.id,
      product.pricePaise,
      newPricePaise,
      reason,
      agentId,
      new Date().toISOString(),
    );
    return { oldPricePaise: product.pricePaise, newPricePaise };
  });
}

export function getPricingHistory(productId?: string, limit = 50) {
  const db = getDb();
  const rows = productId
    ? db.all(
        `SELECT * FROM pricing_history WHERE product_id = ? ORDER BY created_at DESC LIMIT ?`,
        productId,
        limit,
      )
    : db.all(`SELECT * FROM pricing_history ORDER BY created_at DESC LIMIT ?`, limit);
  return rows.map((r) => ({
    id: str(r.id),
    productId: str(r.product_id),
    oldPricePaise: num(r.old_price_paise),
    newPricePaise: num(r.new_price_paise),
    reason: str(r.reason),
    agentId: str(r.agent_id),
    createdAt: str(r.created_at),
  }));
}

// ─── Inventory ───────────────────────────────────────────────────────────────

export function listInventory(): InventoryItem[] {
  return getDb()
    .all(
      `SELECT i.product_id, p.sku, p.name, i.on_hand, i.reserved, i.reorder_point,
              i.supplier_id, i.lead_time_days
         FROM inventory i JOIN products p ON p.id = i.product_id
        ORDER BY i.on_hand ASC`,
    )
    .map((r) => ({
      productId: str(r.product_id),
      sku: str(r.sku),
      name: str(r.name),
      onHand: num(r.on_hand),
      reserved: num(r.reserved),
      reorderPoint: num(r.reorder_point),
      supplierId: str(r.supplier_id),
      leadTimeDays: num(r.lead_time_days),
    }));
}

export function getInventoryItem(productId: string): InventoryItem | null {
  return listInventory().find((i) => i.productId === productId) ?? null;
}

export function adjustStock(productId: string, delta: number): number {
  const db = getDb();
  db.run(
    `UPDATE inventory SET on_hand = MAX(0, on_hand + ?) WHERE product_id = ?`,
    delta,
    productId,
  );
  return num(
    db.get<{ on_hand: number }>(`SELECT on_hand FROM inventory WHERE product_id = ?`, productId)
      ?.on_hand,
  );
}

export function setReorderPoint(productId: string, value: number): void {
  getDb().run(`UPDATE inventory SET reorder_point = ? WHERE product_id = ?`, value, productId);
}

/**
 * Units sold per day over the trailing window. Deterministic — a plain
 * aggregate, not a model estimate.
 */
export function getSalesVelocity(productId: string, days = 14): number {
  const row = getDb().get<{ units: number }>(
    `SELECT COALESCE(SUM(oi.quantity), 0) AS units
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = ?
        AND o.status != 'CANCELLED'
        AND o.created_at >= date('now', ?)`,
    productId,
    `-${days} days`,
  );
  return num(row?.units) / days;
}

export interface StockoutRisk {
  productId: string;
  sku: string;
  name: string;
  onHand: number;
  velocityPerDay: number;
  daysOfCover: number;
  leadTimeDays: number;
  /** Cover minus lead time. Negative means the stockout lands before resupply. */
  slackDays: number;
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export function getStockoutRisks(): StockoutRisk[] {
  return listInventory()
    .map((item) => {
      const velocity = getSalesVelocity(item.productId);
      const daysOfCover = velocity > 0 ? item.onHand / velocity : Infinity;
      const slackDays = daysOfCover - item.leadTimeDays;
      return {
        productId: item.productId,
        sku: item.sku,
        name: item.name,
        onHand: item.onHand,
        velocityPerDay: round(velocity, 2),
        daysOfCover: Number.isFinite(daysOfCover) ? round(daysOfCover, 1) : 999,
        leadTimeDays: item.leadTimeDays,
        slackDays: Number.isFinite(slackDays) ? round(slackDays, 1) : 999,
        risk: riskFromSlack(slackDays, item.onHand),
      };
    })
    .sort((a, b) => a.slackDays - b.slackDays);
}

function riskFromSlack(slack: number, onHand: number): StockoutRisk["risk"] {
  if (onHand === 0) return "CRITICAL";
  if (!Number.isFinite(slack)) return "LOW";
  if (slack <= -3) return "CRITICAL";
  if (slack < 0) return "HIGH";
  if (slack < 4) return "MEDIUM";
  return "LOW";
}

/** Weighted moving average forecast — transparent and reproducible by hand. */
export function forecastDemand(productId: string, horizonDays: number): {
  method: string;
  dailyForecast: number;
  horizonUnits: number;
  confidence: number;
  history: { day: string; units: number }[];
} {
  const history = getDb()
    .all(
      `SELECT date(o.created_at) AS day, SUM(oi.quantity) AS units
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = ? AND o.status != 'CANCELLED'
          AND o.created_at >= date('now', '-21 days')
        GROUP BY day ORDER BY day`,
      productId,
    )
    .map((r) => ({ day: str(r.day), units: num(r.units) }));

  if (history.length === 0) {
    return { method: "weighted moving average", dailyForecast: 0, horizonUnits: 0, confidence: 0.2, history };
  }

  // Recent days count more; weights are linear in recency.
  const recent = history.slice(-14);
  let weightedSum = 0;
  let weightTotal = 0;
  recent.forEach((point, index) => {
    const weight = index + 1;
    weightedSum += point.units * weight;
    weightTotal += weight;
  });
  const dailyForecast = weightedSum / weightTotal;

  const mean = recent.reduce((s, p) => s + p.units, 0) / recent.length;
  const variance = recent.reduce((s, p) => s + (p.units - mean) ** 2, 0) / recent.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
  const confidence = clamp(1 - cv / 2, 0.25, 0.95);

  return {
    method: "weighted moving average (14d, linear recency weights)",
    dailyForecast: round(dailyForecast, 2),
    horizonUnits: Math.ceil(dailyForecast * horizonDays),
    confidence: round(confidence, 2),
    history,
  };
}

// ─── Suppliers ───────────────────────────────────────────────────────────────

export function listSuppliers(): Supplier[] {
  return getDb()
    .all(`SELECT * FROM suppliers ORDER BY name`)
    .map((r) => ({
      id: str(r.id),
      name: str(r.name),
      qualityScore: num(r.quality_score),
      reliabilityScore: num(r.reliability_score),
      leadTimeDays: num(r.lead_time_days),
      minimumOrderQuantity: num(r.minimum_order_quantity),
    }));
}

export function getSupplierQuotes(productId: string): SupplierQuote[] {
  return getDb()
    .all(
      `SELECT q.supplier_id, s.name, q.product_id, q.unit_cost_paise, q.lead_time_days,
              q.minimum_order_quantity, s.quality_score, s.reliability_score
         FROM supplier_quotes q JOIN suppliers s ON s.id = q.supplier_id
        WHERE q.product_id = ?
        ORDER BY q.unit_cost_paise ASC`,
      productId,
    )
    .map((r) => ({
      supplierId: str(r.supplier_id),
      supplierName: str(r.name),
      productId: str(r.product_id),
      unitCostPaise: num(r.unit_cost_paise),
      leadTimeDays: num(r.lead_time_days),
      minimumOrderQuantity: num(r.minimum_order_quantity),
      qualityScore: num(r.quality_score),
      reliabilityScore: num(r.reliability_score),
    }));
}

export function createPurchaseOrder(po: Omit<PurchaseOrder, "createdAt">): PurchaseOrder {
  const createdAt = new Date().toISOString();
  getDb().run(
    `INSERT INTO purchase_orders (id, supplier_id, product_id, quantity, unit_cost_paise,
       total_paise, status, expected_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    po.id,
    po.supplierId,
    po.productId,
    po.quantity,
    po.unitCostPaise,
    po.totalPaise,
    po.status,
    po.expectedAt,
    createdAt,
  );
  return { ...po, createdAt };
}

export function listPurchaseOrders(limit = 50): PurchaseOrder[] {
  return getDb()
    .all(`SELECT * FROM purchase_orders ORDER BY created_at DESC LIMIT ?`, limit)
    .map((r) => ({
      id: str(r.id),
      supplierId: str(r.supplier_id),
      productId: str(r.product_id),
      quantity: num(r.quantity),
      unitCostPaise: num(r.unit_cost_paise),
      totalPaise: num(r.total_paise),
      status: str(r.status) as PurchaseOrder["status"],
      expectedAt: str(r.expected_at),
      createdAt: str(r.created_at),
    }));
}

/** Marks a placed or delayed PO received, once — the stock credit rides with the caller. */
export function markPurchaseOrderReceived(purchaseOrderId: string): void {
  const result = getDb().run(
    `UPDATE purchase_orders SET status = 'RECEIVED'
      WHERE id = ? AND status IN ('PLACED', 'DELAYED')`,
    purchaseOrderId,
  );
  if (result.changes === 0) {
    throw new Error(`Purchase order ${purchaseOrderId} is not awaiting receipt`);
  }
}

// ─── Orders, customers, tickets ──────────────────────────────────────────────

export function listOrders(limit = 100): Order[] {
  return getDb()
    .all(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`, limit)
    .map(mapOrder);
}

export function getOrder(id: string): Order | null {
  const row = getDb().get(`SELECT * FROM orders WHERE id = ?`, id);
  return row ? mapOrder(row) : null;
}

function mapOrder(r: Record<string, unknown>): Order {
  return {
    id: str(r.id),
    customerId: str(r.customer_id),
    status: str(r.status) as Order["status"],
    channel: str(r.channel) as Order["channel"],
    totalPaise: num(r.total_paise),
    costPaise: num(r.cost_paise),
    paymentStatus: str(r.payment_status) as Order["paymentStatus"],
    createdAt: str(r.created_at),
  };
}

export function listCustomers(limit = 100): Customer[] {
  return getDb()
    .all(`SELECT * FROM customers ORDER BY ltv_paise DESC LIMIT ?`, limit)
    .map((r) => ({
      id: str(r.id),
      name: str(r.name),
      email: str(r.email),
      segment: str(r.segment) as Customer["segment"],
      ltvPaise: num(r.ltv_paise),
      ordersCount: num(r.orders_count),
      createdAt: str(r.created_at),
    }));
}

export function listTickets(status?: Ticket["status"]): Ticket[] {
  const db = getDb();
  const rows = status
    ? db.all(`SELECT * FROM tickets WHERE status = ? ORDER BY created_at DESC`, status)
    : db.all(`SELECT * FROM tickets ORDER BY created_at DESC`);
  return rows.map((r) => ({
    id: str(r.id),
    customerId: str(r.customer_id),
    orderId: r.order_id ? str(r.order_id) : null,
    subject: str(r.subject),
    body: str(r.body),
    status: str(r.status) as Ticket["status"],
    reply: r.reply ? str(r.reply) : null,
    createdAt: str(r.created_at),
  }));
}

export function answerTicket(ticketId: string, reply: string, escalate: boolean): boolean {
  const result = getDb().run(
    `UPDATE tickets SET reply = ?, status = ? WHERE id = ? AND status = 'OPEN'`,
    reply,
    escalate ? "ESCALATED" : "ANSWERED",
    ticketId,
  );
  return result.changes > 0;
}

/**
 * Marks an order refunded exactly once.
 *
 * The refund tool's business validation checks the amount against the order
 * total, but nothing checked the payment status: an order already refunded
 * could be refunded again by a second approved request (the executor's
 * duplicate-approval guard keys on the entity, and two agents or two plans can
 * reach the same order with different amounts or reasons). Charging the
 * customer's refund twice is the one mistake here that moves money, so the
 * write itself refuses it.
 */
export function recordRefund(orderId: string, amountPaise: number): string {
  const id = `TXN_DEMO_${Math.abs(hash(orderId + amountPaise)) % 100000}`;
  const db = getDb();
  const changed = db.transaction(() => {
    const claim = db.run(
      `UPDATE orders SET payment_status = 'REFUNDED'
        WHERE id = ? AND payment_status IN ('SUCCESS', 'FAILED')`,
      orderId,
    );
    if (claim.changes === 0) return false;
    db.run(
      `INSERT INTO payments (id, order_id, amount_paise, status, simulated, created_at)
       VALUES (?, ?, ?, 'REFUNDED', 1, ?)`,
      id,
      orderId,
      -amountPaise,
      new Date().toISOString(),
    );
    return true;
  });
  if (!changed) {
    throw new Error(`Order ${orderId} has already been refunded — no second refund was issued.`);
  }
  return id;
}

// ─── Campaigns ───────────────────────────────────────────────────────────────

export function listCampaigns(): Campaign[] {
  return getDb()
    .all(`SELECT * FROM campaigns ORDER BY revenue_paise DESC`)
    .map((r) => ({
      id: str(r.id),
      name: str(r.name),
      channel: str(r.channel) as Campaign["channel"],
      status: str(r.status) as Campaign["status"],
      dailyBudgetPaise: num(r.daily_budget_paise),
      spendPaise: num(r.spend_paise),
      revenuePaise: num(r.revenue_paise),
      clicks: num(r.clicks),
      impressions: num(r.impressions),
      conversions: num(r.conversions),
    }));
}

export interface CampaignEfficiency extends Campaign {
  roas: number;
  cacPaise: number;
  ctr: number;
  conversionRate: number;
  verdict: "HIGH_PERFORMER" | "HEALTHY" | "UNDERPERFORMING" | "WASTING";
}

export function getCampaignEfficiency(): CampaignEfficiency[] {
  return listCampaigns()
    .map((c) => {
      const roas = c.spendPaise > 0 ? c.revenuePaise / c.spendPaise : 0;
      const cacPaise = c.conversions > 0 ? Math.round(c.spendPaise / c.conversions) : 0;
      return {
        ...c,
        roas: round(roas, 2),
        cacPaise,
        ctr: round(pct(c.clicks, c.impressions), 2),
        conversionRate: round(pct(c.conversions, c.clicks), 2),
        verdict: verdictFor(roas),
      };
    })
    .sort((a, b) => b.roas - a.roas);
}

function verdictFor(roas: number): CampaignEfficiency["verdict"] {
  if (roas >= 4) return "HIGH_PERFORMER";
  if (roas >= 2) return "HEALTHY";
  if (roas >= 1) return "UNDERPERFORMING";
  return "WASTING";
}

export function updateCampaignBudget(campaignId: string, newBudgetPaise: number): void {
  getDb().run(
    `UPDATE campaigns SET daily_budget_paise = ? WHERE id = ?`,
    newBudgetPaise,
    campaignId,
  );
}

export function setCampaignStatus(campaignId: string, status: Campaign["status"]): void {
  getDb().run(`UPDATE campaigns SET status = ? WHERE id = ?`, status, campaignId);
}

export function getCampaign(id: string): Campaign | null {
  return listCampaigns().find((c) => c.id === id) ?? null;
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export function getDailyMetrics(days = 30): DailyMetric[] {
  return getDb()
    .all(`SELECT * FROM daily_metrics ORDER BY day DESC LIMIT ?`, days)
    .map((r) => ({
      day: str(r.day),
      sessions: num(r.sessions),
      orders: num(r.orders),
      revenuePaise: num(r.revenue_paise),
      cogsPaise: num(r.cogs_paise),
      adSpendPaise: num(r.ad_spend_paise),
      refundsPaise: num(r.refunds_paise),
      mobilePaymentFailures: num(r.mobile_payment_failures),
      returns: num(r.returns),
    }))
    .reverse();
}

export function upsertDailyMetric(metric: DailyMetric): void {
  getDb().run(
    `INSERT INTO daily_metrics (day, sessions, orders, revenue_paise, cogs_paise,
        ad_spend_paise, refunds_paise, mobile_payment_failures, returns)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET
       sessions = excluded.sessions, orders = excluded.orders,
       revenue_paise = excluded.revenue_paise, cogs_paise = excluded.cogs_paise,
       ad_spend_paise = excluded.ad_spend_paise, refunds_paise = excluded.refunds_paise,
       mobile_payment_failures = excluded.mobile_payment_failures, returns = excluded.returns`,
    metric.day,
    metric.sessions,
    metric.orders,
    metric.revenuePaise,
    metric.cogsPaise,
    metric.adSpendPaise,
    metric.refundsPaise,
    metric.mobilePaymentFailures,
    metric.returns,
  );
}

export interface BusinessSummary {
  revenuePaise: number;
  profitPaise: number;
  cogsPaise: number;
  adSpendPaise: number;
  refundsPaise: number;
  orders: number;
  sessions: number;
  conversionRate: number;
  aovPaise: number;
  roas: number;
  marginPercent: number;
  inventoryRisks: number;
  openTickets: number;
  deltas: {
    revenue: number;
    profit: number;
    orders: number;
    conversion: number;
    aov: number;
  };
}

/** Latest day compared with the mean of the seven days before it. */
export function getBusinessSummary(): BusinessSummary {
  const metrics = getDailyMetrics(30);
  const latest = metrics.at(-1);
  const baselineWindow = metrics.slice(-8, -1);

  if (!latest || baselineWindow.length === 0) {
    return emptySummary();
  }

  const avg = (pick: (m: DailyMetric) => number) =>
    baselineWindow.reduce((s, m) => s + pick(m), 0) / baselineWindow.length;

  const profit = (m: DailyMetric) =>
    m.revenuePaise - m.cogsPaise - m.adSpendPaise - m.refundsPaise;
  const conversion = (m: DailyMetric) => pct(m.orders, m.sessions);
  const aov = (m: DailyMetric) => (m.orders > 0 ? m.revenuePaise / m.orders : 0);

  const inventoryRisks = getStockoutRisks().filter(
    (r) => r.risk === "HIGH" || r.risk === "CRITICAL",
  ).length;
  const openTickets = num(
    getDb().get<{ n: number }>(`SELECT COUNT(*) AS n FROM tickets WHERE status = 'OPEN'`)?.n,
  );

  return {
    revenuePaise: latest.revenuePaise,
    profitPaise: profit(latest),
    cogsPaise: latest.cogsPaise,
    adSpendPaise: latest.adSpendPaise,
    refundsPaise: latest.refundsPaise,
    orders: latest.orders,
    sessions: latest.sessions,
    conversionRate: round(conversion(latest), 2),
    aovPaise: Math.round(aov(latest)),
    roas: latest.adSpendPaise > 0 ? round(latest.revenuePaise / latest.adSpendPaise, 2) : 0,
    marginPercent: round(marginPct(latest.revenuePaise, latest.cogsPaise), 1),
    inventoryRisks,
    openTickets,
    deltas: {
      revenue: round(changePct(avg((m) => m.revenuePaise), latest.revenuePaise), 1),
      profit: round(changePct(avg(profit), profit(latest)), 1),
      orders: round(changePct(avg((m) => m.orders), latest.orders), 1),
      conversion: round(changePct(avg(conversion), conversion(latest)), 1),
      aov: round(changePct(avg(aov), aov(latest)), 1),
    },
  };
}

function emptySummary(): BusinessSummary {
  return {
    revenuePaise: 0, profitPaise: 0, cogsPaise: 0, adSpendPaise: 0, refundsPaise: 0,
    orders: 0, sessions: 0, conversionRate: 0, aovPaise: 0, roas: 0, marginPercent: 0,
    inventoryRisks: 0, openTickets: 0,
    deltas: { revenue: 0, profit: 0, orders: 0, conversion: 0, aov: 0 },
  };
}

/**
 * Revenue = sessions × conversion × AOV. Decomposing the change into those three
 * multiplicative drivers is what lets the Analytics Agent name a cause instead
 * of restating the symptom.
 */
export interface RevenueDecomposition {
  latestDay: string;
  revenueChangePct: number;
  drivers: { name: string; changePct: number; contributionPct: number }[];
  primaryDriver: string;
  supporting: { label: string; value: string; detail?: string }[];
}

export function getRevenueDecomposition(): RevenueDecomposition {
  const metrics = getDailyMetrics(30);
  const latest = metrics.at(-1);
  const window = metrics.slice(-8, -1);
  if (!latest || window.length === 0) {
    return {
      latestDay: latest?.day ?? "",
      revenueChangePct: 0,
      drivers: [],
      primaryDriver: "insufficient history",
      supporting: [],
    };
  }

  const avg = (pick: (m: DailyMetric) => number) =>
    window.reduce((s, m) => s + pick(m), 0) / window.length;

  const baseSessions = avg((m) => m.sessions);
  const baseConversion = avg((m) => pct(m.orders, m.sessions));
  const baseAov = avg((m) => (m.orders > 0 ? m.revenuePaise / m.orders : 0));

  const sessionsChange = changePct(baseSessions, latest.sessions);
  const conversionChange = changePct(baseConversion, pct(latest.orders, latest.sessions));
  const aovChange = changePct(
    baseAov,
    latest.orders > 0 ? latest.revenuePaise / latest.orders : 0,
  );
  const revenueChange = changePct(avg((m) => m.revenuePaise), latest.revenuePaise);

  const total = Math.abs(sessionsChange) + Math.abs(conversionChange) + Math.abs(aovChange) || 1;
  const drivers = [
    { name: "Traffic (sessions)", changePct: round(sessionsChange, 1), contributionPct: round(pct(Math.abs(sessionsChange), total), 0) },
    { name: "Conversion rate", changePct: round(conversionChange, 1), contributionPct: round(pct(Math.abs(conversionChange), total), 0) },
    { name: "Average order value", changePct: round(aovChange, 1), contributionPct: round(pct(Math.abs(aovChange), total), 0) },
  ];

  const primary = [...drivers].sort(
    (a, b) => Math.abs(b.changePct) - Math.abs(a.changePct),
  )[0];

  const baseFailures = avg((m) => m.mobilePaymentFailures);
  const baseReturns = avg((m) => m.returns);

  return {
    latestDay: latest.day,
    revenueChangePct: round(revenueChange, 1),
    drivers,
    primaryDriver: primary.name,
    supporting: [
      {
        label: "Mobile payment failures (attempts)",
        value: String(latest.mobilePaymentFailures),
        detail: `${formatSigned(changePct(baseFailures, latest.mobilePaymentFailures))} vs 7-day average`,
      },
      {
        label: "Returns",
        value: String(latest.returns),
        detail: `${formatSigned(changePct(baseReturns, latest.returns))} vs 7-day average`,
      },
      {
        label: "Ad spend",
        value: String(latest.adSpendPaise),
        detail: `${formatSigned(changePct(avg((m) => m.adSpendPaise), latest.adSpendPaise))} vs 7-day average`,
      },
    ],
  };
}

export function getChannelBreakdown(days = 7) {
  return getDb()
    .all(
      `SELECT channel,
              COUNT(*) AS orders,
              SUM(total_paise) AS revenue,
              SUM(CASE WHEN payment_status = 'FAILED' THEN 1 ELSE 0 END) AS failures
         FROM orders
        WHERE created_at >= date('now', ?)
        GROUP BY channel`,
      `-${days} days`,
    )
    .map((r) => ({
      channel: str(r.channel),
      orders: num(r.orders),
      revenuePaise: num(r.revenue),
      paymentFailures: num(r.failures),
      failureRate: round(pct(num(r.failures), num(r.orders)), 2),
    }));
}

// ─── Agents ──────────────────────────────────────────────────────────────────

export function setAgentStatus(agentId: AgentId, status: string, activity: string): void {
  getDb().run(
    `UPDATE agents SET status = ?, activity = ?, last_active_at = ? WHERE id = ?`,
    status,
    activity,
    new Date().toISOString(),
    agentId,
  );
}

export function getAgentRow(agentId: AgentId) {
  return getDb().get(`SELECT * FROM agents WHERE id = ?`, agentId);
}

export function getAgentBudget(agentId: AgentId): { limitPaise: number; usedPaise: number } {
  rolloverBudgets();
  const row = getDb().get<{ daily_budget_paise: number; budget_used_paise: number }>(
    `SELECT daily_budget_paise, budget_used_paise FROM agents WHERE id = ?`,
    agentId,
  );
  return {
    limitPaise: num(row?.daily_budget_paise),
    usedPaise: num(row?.budget_used_paise),
  };
}

export function chargeBudget(agentId: AgentId, amountPaise: number): void {
  rolloverBudgets();
  getDb().run(
    `UPDATE agents SET budget_used_paise = budget_used_paise + ? WHERE id = ?`,
    amountPaise,
    agentId,
  );
}

/**
 * Resets daily spend when the day has changed.
 *
 * `budget_used_paise` is the "daily" budget counter, but nothing ever reset it:
 * on the second day an agent had already spent its full authority the day
 * before, so every action parked for a human — and after enough days, every
 * action from every spending agent, permanently. The fix reads the day the
 * counters were last zeroed from `system_state` and clears them once per
 * calendar day. Idempotent within a day: a second call in the same day writes
 * nothing.
 */
function rolloverBudgets(): void {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const last = getState("budget_rollover_day");
  if (last === today) return;

  db.transaction(() => {
    // Re-check inside the transaction so two concurrent calls cannot both roll
    // over — the second sees the day the first just wrote and stops.
    const inFlight = getState("budget_rollover_day");
    if (inFlight === today) return;
    db.run(`UPDATE agents SET budget_used_paise = 0`);
    setState("budget_rollover_day", today);
  });
}

export function bumpAgentMetrics(
  agentId: AgentId,
  patch: Partial<{
    tasks_completed: number;
    tasks_failed: number;
    tool_calls: number;
    total_latency_ms: number;
    approvals_requested: number;
    approvals_rejected: number;
    impact_paise: number;
  }>,
): void {
  const columns = Object.keys(patch);
  if (columns.length === 0) return;
  const assignments = columns.map((c) => `${c} = ${c} + ?`).join(", ");
  getDb().run(
    `INSERT INTO agent_metrics (agent_id) VALUES (?) ON CONFLICT(agent_id) DO NOTHING`,
    agentId,
  );
  getDb().run(
    `UPDATE agent_metrics SET ${assignments} WHERE agent_id = ?`,
    ...columns.map((c) => num(patch[c as keyof typeof patch])),
    agentId,
  );
}

export function getAgentMetrics(agentId: AgentId) {
  const row = getDb().get(`SELECT * FROM agent_metrics WHERE agent_id = ?`, agentId);
  const toolCalls = num(row?.tool_calls);
  return {
    tasksCompleted: num(row?.tasks_completed),
    tasksFailed: num(row?.tasks_failed),
    toolCalls,
    avgLatencyMs: toolCalls > 0 ? Math.round(num(row?.total_latency_ms) / toolCalls) : 0,
    approvalsRequested: num(row?.approvals_requested),
    approvalsRejected: num(row?.approvals_rejected),
    impactPaise: num(row?.impact_paise),
  };
}

// ─── Audit ───────────────────────────────────────────────────────────────────

export function writeAudit(entry: Omit<AuditEntry, "id" | "createdAt"> & { latencyMs?: number }): void {
  getDb().run(
    `INSERT INTO audit_logs (id, created_at, agent_id, action, entity_type, entity_id,
        input, output, policy_result, approval_required, approval_status, risk,
        execution_status, correlation_id, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    new Date().toISOString(),
    entry.agentId,
    entry.action,
    entry.entityType,
    entry.entityId,
    toJson(entry.input),
    toJson(entry.output),
    entry.policyResult,
    entry.approvalRequired ? 1 : 0,
    entry.approvalStatus,
    entry.risk,
    entry.executionStatus,
    entry.correlationId,
    entry.latencyMs ?? 0,
  );
}

export function listAudit(filters: {
  agentId?: string;
  risk?: string;
  status?: string;
  limit?: number;
} = {}): AuditEntry[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filters.agentId) { clauses.push("agent_id = ?"); params.push(filters.agentId); }
  if (filters.risk) { clauses.push("risk = ?"); params.push(filters.risk); }
  if (filters.status) { clauses.push("execution_status = ?"); params.push(filters.status); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(filters.limit ?? 100);

  return getDb()
    .all(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ?`, ...params)
    .map((r) => ({
      id: str(r.id),
      createdAt: str(r.created_at),
      agentId: str(r.agent_id),
      action: str(r.action),
      entityType: str(r.entity_type),
      entityId: str(r.entity_id),
      input: fromJson(r.input, null),
      output: fromJson(r.output, null),
      policyResult: str(r.policy_result) as AuditEntry["policyResult"],
      approvalRequired: num(r.approval_required) === 1,
      approvalStatus: r.approval_status ? str(r.approval_status) : null,
      risk: str(r.risk) as AuditEntry["risk"],
      executionStatus: str(r.execution_status) as AuditEntry["executionStatus"],
      correlationId: str(r.correlation_id),
    }));
}

// ─── Approvals ───────────────────────────────────────────────────────────────

export function createApproval(approval: Approval): void {
  getDb().run(
    `INSERT INTO approvals (id, agent_id, tool_name, input, title, reason, entity_type,
        entity_id, financial_impact_paise, risk, policy_id, expected_outcome, status,
        task_id, correlation_id, created_at, resolved_at, resolved_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    approval.id,
    approval.agentId,
    approval.toolName,
    toJson(approval.input),
    approval.title,
    approval.reason,
    approval.entityType,
    approval.entityId,
    approval.financialImpactPaise,
    approval.risk,
    approval.policyId,
    approval.expectedOutcome,
    approval.status,
    approval.taskId,
    approval.correlationId,
    approval.createdAt,
    approval.resolvedAt,
    approval.resolvedBy,
  );
}

export function listApprovals(status?: Approval["status"]): Approval[] {
  const db = getDb();
  const rows = status
    ? db.all(`SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC`, status)
    : db.all(`SELECT * FROM approvals ORDER BY created_at DESC LIMIT 100`);
  return rows.map(mapApproval);
}

export function getApproval(id: string): Approval | null {
  const row = getDb().get(`SELECT * FROM approvals WHERE id = ?`, id);
  return row ? mapApproval(row) : null;
}

export function resolveApproval(
  id: string,
  status: "APPROVED" | "REJECTED",
  by: string,
): boolean {
  const result = getDb().run(
    `UPDATE approvals SET status = ?, resolved_at = ?, resolved_by = ?
      WHERE id = ? AND status = 'PENDING'`,
    status,
    new Date().toISOString(),
    by,
    id,
  );
  return result.changes > 0;
}

function mapApproval(r: Record<string, unknown>): Approval {
  return {
    id: str(r.id),
    agentId: str(r.agent_id) as AgentId,
    toolName: str(r.tool_name),
    input: fromJson<Record<string, unknown>>(r.input, {}),
    title: str(r.title),
    reason: str(r.reason),
    entityType: str(r.entity_type),
    entityId: str(r.entity_id),
    financialImpactPaise: num(r.financial_impact_paise),
    risk: str(r.risk) as Approval["risk"],
    policyId: r.policy_id ? str(r.policy_id) : null,
    expectedOutcome: str(r.expected_outcome),
    status: str(r.status) as Approval["status"],
    taskId: r.task_id ? str(r.task_id) : null,
    correlationId: str(r.correlation_id),
    createdAt: str(r.created_at),
    resolvedAt: r.resolved_at ? str(r.resolved_at) : null,
    resolvedBy: r.resolved_by ? str(r.resolved_by) : null,
  };
}

// ─── Goals ───────────────────────────────────────────────────────────────────

export function createGoal(goal: BusinessGoal): void {
  getDb().run(
    `INSERT INTO business_goals (id, statement, metric, target_percent, constraints,
        deadline_days, baseline_value, current_value, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    goal.id,
    goal.statement,
    goal.metric,
    goal.targetPercent,
    toJson(goal.constraints),
    goal.deadlineDays,
    goal.baselineValue,
    goal.currentValue,
    goal.status,
    goal.createdAt,
  );
}

export function listGoals(): BusinessGoal[] {
  return getDb()
    .all(`SELECT * FROM business_goals ORDER BY created_at DESC`)
    .map((r) => ({
      id: str(r.id),
      statement: str(r.statement),
      metric: str(r.metric) as BusinessGoal["metric"],
      targetPercent: num(r.target_percent),
      constraints: fromJson<string[]>(r.constraints, []),
      deadlineDays: num(r.deadline_days),
      baselineValue: num(r.baseline_value),
      currentValue: num(r.current_value),
      status: str(r.status) as BusinessGoal["status"],
      createdAt: str(r.created_at),
    }));
}

export function updateGoalProgress(goalId: string, currentValue: number): void {
  getDb().run(`UPDATE business_goals SET current_value = ? WHERE id = ?`, currentValue, goalId);
}

// ─── Memory ──────────────────────────────────────────────────────────────────

export function rememberFact(record: Omit<MemoryRecord, "id" | "createdAt" | "terms">): MemoryRecord {
  const entry: MemoryRecord = {
    ...record,
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    terms: tokenise(record.content).join(" "),
    createdAt: new Date().toISOString(),
  };
  getDb().run(
    `INSERT INTO agent_memory (id, agent_id, kind, content, terms, importance, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    entry.id,
    entry.agentId,
    entry.kind,
    entry.content,
    entry.terms,
    entry.importance,
    entry.createdAt,
  );
  return entry;
}

export function listMemory(agentId?: string, limit = 100): MemoryRecord[] {
  const db = getDb();
  const rows = agentId
    ? db.all(`SELECT * FROM agent_memory WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`, agentId, limit)
    : db.all(`SELECT * FROM agent_memory ORDER BY created_at DESC LIMIT ?`, limit);
  return rows.map((r) => ({
    id: str(r.id),
    agentId: str(r.agent_id) as MemoryRecord["agentId"],
    kind: str(r.kind) as MemoryRecord["kind"],
    content: str(r.content),
    terms: str(r.terms),
    importance: num(r.importance),
    createdAt: str(r.created_at),
  }));
}

export function clearMemory(agentId?: string): number {
  const result = agentId
    ? getDb().run(`DELETE FROM agent_memory WHERE agent_id = ?`, agentId)
    : getDb().run(`DELETE FROM agent_memory`);
  return result.changes;
}

/**
 * Relevance-ranked recall. Term overlap, not embeddings — at this corpus size
 * it is both better and free. See docs/architecture.md §vector search.
 */
export function recallMemory(agentId: string, query: string, limit = 5): MemoryRecord[] {
  const queryTerms = new Set(tokenise(query));
  if (queryTerms.size === 0) return listMemory(agentId, limit);
  return listMemory(agentId, 200)
    .map((record) => {
      const terms = record.terms.split(" ");
      const overlap = terms.filter((t) => queryTerms.has(t)).length;
      const score = overlap / Math.sqrt(terms.length || 1) + record.importance * 0.3;
      return { record, score };
    })
    .filter((r) => r.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.record);
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "was", "are",
  "with", "by", "at", "from", "that", "this", "it", "as", "be", "has", "have",
]);

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// ─── System state ────────────────────────────────────────────────────────────

export function setState(key: string, value: string): void {
  getDb().run(
    `INSERT INTO system_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}

export function getState(key: string): string | null {
  const row = getDb().get<{ value: string }>(`SELECT value FROM system_state WHERE key = ?`, key);
  return row?.value ?? null;
}

// ─── Fulfillment ─────────────────────────────────────────────────────────────

type FulfillmentRow = {
  id: string;
  order_id: string;
  external_id: string | null;
  supplier: string;
  status: string;
  tracking_url: string | null;
  attempts: number;
  last_error: string | null;
  simulated: number;
  created_at: string;
  updated_at: string;
};

const mapFulfillment = (r: FulfillmentRow): Fulfillment => ({
  id: r.id,
  orderId: r.order_id,
  externalId: r.external_id,
  supplier: r.supplier,
  status: r.status as FulfillmentStatus,
  trackingUrl: r.tracking_url,
  attempts: num(r.attempts),
  lastError: r.last_error,
  simulated: Boolean(r.simulated),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function createFulfillment(input: {
  id: string;
  orderId: string;
  supplier: string;
}): Fulfillment {
  const now = new Date().toISOString();
  getDb().run(
    `INSERT INTO fulfillments (id, order_id, external_id, supplier, status,
        tracking_url, attempts, last_error, simulated, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 'PENDING_SUPPLIER', NULL, 0, NULL, 1, ?, ?)`,
    input.id,
    input.orderId,
    input.supplier,
    now,
    now,
  );
  return getFulfillment(input.id)!;
}

export function getFulfillment(id: string): Fulfillment | null {
  const row = getDb().get<FulfillmentRow>(`SELECT * FROM fulfillments WHERE id = ?`, id);
  return row ? mapFulfillment(row) : null;
}

/** One order gets one fulfilment; this is what makes the tool idempotent. */
export function getFulfillmentForOrder(orderId: string): Fulfillment | null {
  const row = getDb().get<FulfillmentRow>(
    `SELECT * FROM fulfillments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`,
    orderId,
  );
  return row ? mapFulfillment(row) : null;
}

export function listFulfillments(status?: FulfillmentStatus, limit = 100): Fulfillment[] {
  const rows = status
    ? getDb().all<FulfillmentRow>(
        `SELECT * FROM fulfillments WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
        status,
        limit,
      )
    : getDb().all<FulfillmentRow>(
        `SELECT * FROM fulfillments ORDER BY created_at DESC LIMIT ?`,
        limit,
      );
  return rows.map(mapFulfillment);
}

export function updateFulfillment(
  id: string,
  patch: {
    status?: FulfillmentStatus;
    externalId?: string | null;
    trackingUrl?: string | null;
    lastError?: string | null;
    simulated?: boolean;
    bumpAttempts?: boolean;
  },
): void {
  const sets: string[] = [`updated_at = ?`];
  const params: (string | number | null)[] = [new Date().toISOString()];

  const set = (column: string, value: string | number | null) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.status !== undefined) set("status", patch.status);
  if (patch.externalId !== undefined) set("external_id", patch.externalId);
  if (patch.trackingUrl !== undefined) set("tracking_url", patch.trackingUrl);
  if (patch.lastError !== undefined) set("last_error", patch.lastError);
  if (patch.simulated !== undefined) set("simulated", patch.simulated ? 1 : 0);
  if (patch.bumpAttempts) sets.push(`attempts = attempts + 1`);

  getDb().run(`UPDATE fulfillments SET ${sets.join(", ")} WHERE id = ?`, ...params, id);
}

/** The line items a supplier needs, resolved to SKUs. */
export function getOrderLines(orderId: string): { sku: string; quantity: number }[] {
  return getDb().all<{ sku: string; quantity: number }>(
    `SELECT p.sku AS sku, oi.quantity AS quantity
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ?`,
    orderId,
  );
}

// ─── Machine orders (AI buyers) ───────────────────────────────────────────────

export interface MachineOrderLine {
  productId: string;
  quantity: number;
  unitPricePaise: number;
}

export interface MachineOrder {
  id: string;
  buyerId: string;
  status: "PENDING_PAYMENT" | "PAID" | "CANCELLED";
  totalPaise: number;
  lines: MachineOrderLine[];
  processorOrderId: string | null;
  paymentSimulated: boolean;
  createdAt: string;
}

/**
 * Places a machine order as `PENDING_PAYMENT` and creates the payment order
 * on the gateway. No stock is reserved, no fulfilment starts and no revenue is
 * recognised until the payment is confirmed — a buyer's cart is intent, not a
 * completed sale, and the system treats it that way.
 *
 * Idempotent per buyer: one open cart at a time. A second request replaces the
 * previous pending order (cancelling its un-paid payment order) rather than
 * accumulating carts per buyer — the same shape as a storefront session.
 */
export function createMachineOrder(input: {
  buyerId: string;
  lines: { productId: string; quantity: number }[];
  processorOrderId: string;
  paymentSimulated: boolean;
}): MachineOrder {
  const db = getDb();
  return db.transaction(() => {
    // Cancel any previous unpaid cart from this buyer.
    const open = db.all<{ id: string }>(
      `SELECT id FROM machine_orders WHERE buyer_id = ? AND status = 'PENDING_PAYMENT'`,
      input.buyerId,
    );
    for (const row of open) {
      db.run(
        `UPDATE machine_orders SET status = 'CANCELLED' WHERE id = ?`,
        row.id,
      );
    }

    const productIds = input.lines.map((l) => l.productId);
    const rows = productIds.length
      ? db.all<{ id: string; price_paise: number }>(
          `SELECT id, price_paise FROM products WHERE id IN (${productIds.map(() => "?").join(",")})`,
          ...productIds,
        )
      : [];
    const priceById = new Map(rows.map((r) => [str(r.id), num(r.price_paise)]));
    for (const line of input.lines) {
      if (!priceById.has(line.productId)) {
        throw new Error(`Unknown product ${line.productId} in the cart`);
      }
    }

    const lines: MachineOrderLine[] = input.lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      unitPricePaise: priceById.get(l.productId)!,
    }));
    const totalPaise = lines.reduce((sum, l) => sum + l.unitPricePaise * l.quantity, 0);

    const now = new Date().toISOString();
    const id = `mord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    db.run(
      `INSERT INTO machine_orders (id, buyer_id, status, total_paise, processor_order_id,
          payment_simulated, created_at) VALUES (?, ?, 'PENDING_PAYMENT', ?, ?, ?, ?)`,
      id, input.buyerId, totalPaise, input.processorOrderId,
      input.paymentSimulated ? 1 : 0, now,
    );
    for (const line of lines) {
      db.run(
        `INSERT INTO machine_order_lines (order_id, product_id, quantity, unit_price_paise)
         VALUES (?, ?, ?, ?)`,
        id, line.productId, line.quantity, line.unitPricePaise,
      );
    }
    return getMachineOrder(id)!;
  });
}

export function getMachineOrder(id: string): MachineOrder | null {
  const db = getDb();
  const row = db.get(`SELECT * FROM machine_orders WHERE id = ?`, id);
  if (!row) return null;
  const lines = db
    .all(`SELECT * FROM machine_order_lines WHERE order_id = ?`, id)
    .map((l) => ({
      productId: str(l.product_id),
      quantity: num(l.quantity),
      unitPricePaise: num(l.unit_price_paise),
    }));
  return {
    id: str(row.id),
    buyerId: str(row.buyer_id),
    status: str(row.status) as MachineOrder["status"],
    totalPaise: num(row.total_paise),
    lines,
    processorOrderId: row.processor_order_id ? str(row.processor_order_id) : null,
    paymentSimulated: Boolean(num(row.payment_simulated)),
    createdAt: str(row.created_at),
  };
}

export function listMachineOrders(limit = 50): MachineOrder[] {
  const db = getDb();
  return db
    .all(`SELECT id FROM machine_orders ORDER BY created_at DESC LIMIT ?`, limit)
    .map((r) => getMachineOrder(str(r.id))!)
    .filter(Boolean);
}

/** Confirms payment on a machine order — the only transition into PAID. */
export function markMachineOrderPaid(id: string, paymentReference: string): MachineOrder {
  const db = getDb();
  const changed = db.run(
    `UPDATE machine_orders SET status = 'PAID', processor_order_id = ?
      WHERE id = ? AND status = 'PENDING_PAYMENT'`,
    paymentReference,
    id,
  );
  if (changed.changes === 0) {
    throw new Error(`Machine order ${id} is not awaiting payment`);
  }
  return getMachineOrder(id)!;
}

/** Stock required to serve a cart, against what is actually on the shelf. */
export function checkCartStock(lines: { productId: string; quantity: number }[]): {
  productId: string;
  sku: string;
  requested: number;
  onHand: number;
}[] {
  return lines.map((line) => {
    const item = getInventoryItem(line.productId);
    return {
      productId: line.productId,
      sku: item?.sku ?? line.productId,
      requested: line.quantity,
      onHand: item?.onHand ?? 0,
    };
  });
}

// ─── Utilities ───────────────────────────────────────────────────────────────

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  return h;
}
