/**
 * Tool execution pipeline.
 *
 *   agent → tool call → input validation → governance → execution → audit → event
 *
 * Nothing skips a step. An agent cannot execute a tool by any other path, which
 * is what makes the permission and policy guarantees real rather than advisory.
 */
import { ZodError } from "zod";
import { getTool, type RegisteredTool } from "./definitions";
import { evaluate } from "@/policies/governance";
import { getBus } from "@/events/bus";
import {
  bumpAgentMetrics,
  chargeBudget,
  createApproval,
  listApprovals,
  writeAudit,
} from "@/database/queries";
import { formatMoney } from "@/lib/money";
import { newId } from "@/lib/ids";
import type {
  AgentId,
  Approval,
  EventType,
  GovernanceResult,
  ToolContext,
} from "@/types";

export interface ToolCallResult {
  status: "COMPLETED" | "DENIED" | "PENDING_APPROVAL" | "FAILED";
  toolName: string;
  output: unknown;
  governance: GovernanceResult;
  approvalId?: string;
  error?: string;
  latencyMs: number;
}

/** Thrown only for programmer errors (unknown tool); business failures are returned. */
export class UnknownToolError extends Error {}

export async function callTool(
  toolName: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  const started = Date.now();
  const tool = getTool(toolName);
  if (!tool) throw new UnknownToolError(`No such tool: ${toolName}`);

  // 1 — Input validation. A malformed call never reaches governance.
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const message = describeZodError(parsed.error);
    const governance: GovernanceResult = {
      decision: "DENY",
      risk: "LOW",
      reasons: [{ check: "SCHEMA", decision: "DENY", message }],
      financialImpactPaise: 0,
      budget: null,
    };
    return finish(tool, rawInput, ctx, governance, {
      status: "DENIED",
      output: null,
      error: message,
      started,
    });
  }
  const input = parsed.data;

  // 2 — Governance.
  const governance = evaluate(tool, input, ctx.agentId);

  if (governance.decision === "DENY") {
    return finish(tool, input, ctx, governance, {
      status: "DENIED",
      output: null,
      error: denialMessage(governance),
      started,
    });
  }

  // 3 — Approval. The call is parked, not executed; the approval carries
  //     everything needed to replay it verbatim once a human decides.
  if (governance.decision === "REQUIRE_APPROVAL" && !ctx.approvalId) {
    // A plan can propose the same action twice — two agents reaching the same
    // conclusion, or two plans running over the same data. Approving both would
    // double-order stock or double-refund a customer, so an identical pending
    // request is reused rather than duplicated.
    const duplicate = findPendingDuplicate(tool.name, entityIdFor(input));
    if (duplicate) {
      return finish(tool, input, ctx, governance, {
        status: "PENDING_APPROVAL",
        output: { approvalId: duplicate.id, deduplicated: true },
        approvalId: duplicate.id,
        started,
      });
    }

    const approval = buildApproval(tool, input, ctx, governance);
    createApproval(approval);
    bumpAgentMetrics(ctx.agentId, { approvals_requested: 1 });
    getBus().publish(
      "APPROVAL_REQUESTED",
      { approvalId: approval.id, agentId: ctx.agentId, title: approval.title },
      { source: ctx.agentId, correlationId: ctx.correlationId },
    );
    return finish(tool, input, ctx, governance, {
      status: "PENDING_APPROVAL",
      output: { approvalId: approval.id },
      approvalId: approval.id,
      started,
    });
  }

  // 4 — Execute.
  try {
    const output = await tool.execute(input, ctx);
    if (tool.mutates && governance.financialImpactPaise > 0) {
      chargeBudget(ctx.agentId, governance.financialImpactPaise);
    }
    bumpAgentMetrics(ctx.agentId, {
      tool_calls: 1,
      total_latency_ms: Date.now() - started,
      impact_paise: tool.mutates ? governance.financialImpactPaise : 0,
    });
    emitDomainEvent(tool.name, input, output, ctx);
    return finish(tool, input, ctx, governance, { status: "COMPLETED", output, started });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return finish(tool, input, ctx, governance, {
      status: "FAILED",
      output: null,
      error: message,
      started,
    });
  }
}

/**
 * Re-runs a call a human approved. Governance runs again — an approval grants
 * the approval requirement only; a policy DENY still blocks, so an approval
 * that has gone stale (price moved, stock changed) cannot execute anyway.
 */
export async function executeApproved(approval: Approval): Promise<ToolCallResult> {
  return callTool(approval.toolName, approval.input, {
    agentId: approval.agentId,
    taskId: approval.taskId,
    correlationId: approval.correlationId,
    approvalId: approval.id,
  });
}

// ─── Internals ───────────────────────────────────────────────────────────────

function finish(
  tool: RegisteredTool,
  input: unknown,
  ctx: ToolContext,
  governance: GovernanceResult,
  result: {
    status: ToolCallResult["status"];
    output: unknown;
    error?: string;
    approvalId?: string;
    started: number;
  },
): ToolCallResult {
  const latencyMs = Date.now() - result.started;

  writeAudit({
    agentId: ctx.agentId,
    action: tool.name,
    entityType: entityTypeFor(tool.name),
    entityId: entityIdFor(input),
    input,
    output: result.output,
    policyResult: governance.decision,
    approvalRequired: governance.decision === "REQUIRE_APPROVAL",
    approvalStatus: result.approvalId ? "PENDING" : null,
    risk: governance.risk,
    executionStatus: result.status,
    correlationId: ctx.correlationId,
    latencyMs,
  });

  getBus().publish(
    "TOOL_CALLED",
    {
      tool: tool.name,
      agentId: ctx.agentId,
      status: result.status,
      decision: governance.decision,
      risk: governance.risk,
      error: result.error ?? null,
    },
    { source: ctx.agentId, correlationId: ctx.correlationId },
  );

  return {
    status: result.status,
    toolName: tool.name,
    output: result.output,
    governance,
    approvalId: result.approvalId,
    error: result.error,
    latencyMs,
  };
}

/** An outstanding request for the same action on the same entity. */
function findPendingDuplicate(toolName: string, entityId: string) {
  if (entityId === "-") return null;
  return (
    listApprovals("PENDING").find(
      (approval) => approval.toolName === toolName && approval.entityId === entityId,
    ) ?? null
  );
}

function buildApproval(
  tool: RegisteredTool,
  input: Record<string, unknown>,
  ctx: ToolContext,
  governance: GovernanceResult,
): Approval {
  const trigger = governance.reasons.find((r) => r.decision === "REQUIRE_APPROVAL");
  return {
    id: newId("apr"),
    agentId: ctx.agentId as AgentId,
    toolName: tool.name,
    input,
    title: approvalTitle(tool.name, input, governance.financialImpactPaise),
    reason: String(input.reason ?? trigger?.message ?? "Requested by agent"),
    entityType: entityTypeFor(tool.name),
    entityId: entityIdFor(input),
    financialImpactPaise: governance.financialImpactPaise,
    risk: governance.risk,
    policyId: trigger?.policyId ?? null,
    expectedOutcome: expectedOutcome(tool.name, input),
    status: "PENDING",
    taskId: ctx.taskId,
    correlationId: ctx.correlationId,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
  };
}

function approvalTitle(
  toolName: string,
  input: Record<string, unknown>,
  impactPaise: number,
): string {
  switch (toolName) {
    case "create_purchase_order":
      return `Purchase ${input.quantity} units for ${formatMoney(impactPaise)}`;
    case "create_refund":
      return `Refund ${formatMoney(impactPaise)} on order ${input.orderId}`;
    case "update_price":
      return `Change price of ${input.productId}`;
    case "propose_budget_change":
      return `Move ${formatMoney(Math.abs(Number(input.deltaPaise ?? 0)))} of campaign budget`;
    case "pause_campaign":
      return `Pause campaign ${input.campaignId}`;
    case "adjust_reorder_point":
      return `Change reorder point for ${input.productId} by ${input.delta}`;
    case "reply_ticket":
      return `Reply to ticket ${input.ticketId}`;
    case "place_machine_order":
      return `Place AI-buyer cart ${input.buyerId ? `for ${input.buyerId}` : ""}`;
    case "confirm_machine_payment":
      return `Confirm payment on machine order ${input.machineOrderId}`;
    default:
      return `Run ${toolName}`;
  }
}

function expectedOutcome(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "create_purchase_order":
      return `Stock replenished on arrival; stockout risk cleared for this SKU.`;
    case "create_refund":
      return `Customer refunded; order marked REFUNDED. Payment is simulated.`;
    case "update_price":
      return `Price updated to ${formatMoney(Number(input.newPricePaise ?? 0))} and recorded in pricing history.`;
    case "propose_budget_change":
      return `Campaign daily budget adjusted. No ad platform is contacted.`;
    default:
      return `Tool ${toolName} executes with the reviewed inputs.`;
  }
}

const ENTITY_TYPES: Record<string, string> = {
  update_price: "product",
  simulate_price_change: "product",
  calculate_margin: "product",
  adjust_reorder_point: "product",
  forecast_demand: "product",
  get_sales_velocity: "product",
  create_purchase_order: "purchase_order",
  receive_purchase_order: "purchase_order",
  get_supplier_quotes: "product",
  create_refund: "order",
  reply_ticket: "ticket",
  propose_budget_change: "campaign",
  pause_campaign: "campaign",
  draft_campaign_copy: "product",
  place_machine_order: "machine_order",
  confirm_machine_payment: "machine_order",
  get_machine_order: "machine_order",
};

const entityTypeFor = (toolName: string): string => ENTITY_TYPES[toolName] ?? "business";

function entityIdFor(input: unknown): string {
  if (!input || typeof input !== "object") return "-";
  const record = input as Record<string, unknown>;
  for (const key of ["productId", "orderId", "campaignId", "ticketId", "purchaseOrderId", "machineOrderId"]) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  // A machine cart's entity is the buyer's session: one pending cart per buyer
  // is the rule, so a second pending request for the same buyer is a duplicate
  // even though no single field carries it.
  if (record.toolName !== undefined) return "-";
  if (typeof record.buyerId === "string" && typeof record.items === "object") {
    return `buyer:${record.buyerId}`;
  }
  return "-";
}

/** Mutations announce themselves so other agents can react. */
function emitDomainEvent(
  toolName: string,
  input: Record<string, unknown>,
  output: unknown,
  ctx: ToolContext,
): void {
  const mapping: Record<string, EventType> = {
    update_price: "PRICE_CHANGED",
    create_purchase_order: "PURCHASE_ORDER_CREATED",
    create_refund: "REFUND_REQUESTED",
    propose_budget_change: "CAMPAIGN_PERFORMANCE_CHANGED",
    pause_campaign: "CAMPAIGN_PERFORMANCE_CHANGED",
    place_machine_order: "MACHINE_ORDER_CREATED",
  };
  const type = mapping[toolName];
  if (!type) return;
  getBus().publish(
    type,
    { ...input, result: output },
    { source: ctx.agentId, correlationId: ctx.correlationId },
  );
}

function describeZodError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
}

function denialMessage(governance: GovernanceResult): string {
  return (
    governance.reasons.find((r) => r.decision === "DENY")?.message ?? "Denied by governance"
  );
}
