/**
 * The agentic commerce showcase — server half.
 *
 * Gathers every figure the showcase states from the real database and policy
 * table, so the page inherits the same honesty rules as the rest of the
 * console: nothing on it is a mock number. The client half (components/
 * agentic-showcase.tsx) renders the 3D scene and scroll effects.
 */
import { AGENT_IDS } from "@/agents/definitions";
import { POLICY_LIMITS } from "@/policies/rules";
import { describePayments } from "@/integrations/payments";
import { describeSupplier } from "@/integrations/supplier";
import { describeEngine } from "@/ai/gateway";
import { getDb, num } from "@/database/db";
import {
  getBusinessSummary,
  listApprovals,
  listAudit,
  listProducts,
} from "@/database/queries";
import { ensureSeeded } from "@/simulation/seed";
import { AgenticShowcase, type ShowcaseData } from "@/components/agentic-showcase";

export const dynamic = "force-dynamic";

/**
 * Real AOV uplift from multi-line baskets, computed from the order table —
 * the same arithmetic the upsell direction claims, so the number on the page
 * is measured rather than asserted.
 */
function measuredAovLift(): number {
  const db = getDb();
  const single = num(
    db
      .get<{ v: number }>(
        `SELECT AVG(total_paise) AS v FROM orders o
          WHERE o.status != 'CANCELLED'
            AND (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) = 1`,
      )
      ?.v,
  );
  const multi = num(
    db
      .get<{ v: number }>(
        `SELECT AVG(total_paise) AS v FROM orders o
          WHERE o.status != 'CANCELLED'
            AND (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) > 1`,
      )
      ?.v,
  );
  if (single <= 0) return 0;
  return ((multi - single) / single) * 100;
}

export default function ShowcasePage() {
  ensureSeeded();

  const summary = getBusinessSummary();
  const approvals = listApprovals("PENDING");
  const catalogSize = listProducts(200).length;

  // The last governance verdicts, exactly as the audit log holds them.
  const audit = listAudit({ limit: 24 }).map((entry) => ({
    time: entry.createdAt.slice(11, 19),
    agent: entry.agentId,
    action: entry.action,
    decision: entry.policyResult,
    entity: entry.entityId === "-" ? entry.entityType : entry.entityId,
    impact:
      entry.executionStatus === "COMPLETED" && entry.input
        ? `₹${(Number((entry.input as Record<string, unknown>).amountPaise ?? 0) / 100).toFixed(0)}`
        : "₹0",
  }));

  // Upsell stat: measured multi-line vs single-line AOV from the order table.
  const aovLiftPct = measuredAovLift();
  const payments = describePayments();
  const supplier = describeSupplier();
  const engine = describeEngine();

  const data: ShowcaseData = {
    latestDay: summary.revenuePaise > 0 ? latestDayLabel() : "—",
    revenueCompact: String(summary.revenuePaise),
    agents: AGENT_IDS.length,
    pending: approvals.length,
    catalogSize,
    engine: engine.mode === "deterministic" ? "Demo mode — Deterministic Business Engine" : engine.label,
    engineMode: engine.mode === "deterministic" ? "deterministic" : "hosted",
    auditTrail: audit,
    aovLiftPct,
    roas: summary.roas,
    conversionPct: summary.conversionRate,
    payments: { label: payments.label, live: payments.live, detail: payments.detail },
    supplier: { label: supplier.label, live: supplier.live, detail: supplier.detail },
    bounds: {
      refundLimitPaise: POLICY_LIMITS.financial.maxAutoRefundPaise,
      poLimitPaise: POLICY_LIMITS.financial.maxAutoPurchaseOrderPaise,
      ceilingPaise: POLICY_LIMITS.financial.hardCeilingPaise,
      marginFloorPct: POLICY_LIMITS.pricing.minimumMarginPercent,
      priceStepPct: POLICY_LIMITS.pricing.maxPriceChangePercent,
      budgetMovePaise: POLICY_LIMITS.marketing.maxDailyBudgetChangePaise,
    },
  };

  return <AgenticShowcase data={data} />;
}

function latestDayLabel(): string {
  const now = new Date();
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
