/**
 * Shared domain types for the Multi-Agent Commerce OS.
 *
 * Money is always stored and passed as an integer number of paise (1/100 ₹).
 * Never use floats for money — see lib/money.ts for the formatting layer.
 */
import type { ZodType } from "zod";

// ─── Agents ──────────────────────────────────────────────────────────────────

export type AgentId =
  | "ceo"
  | "analytics"
  | "inventory"
  | "pricing"
  | "marketing"
  | "customer"
  | "procurement"
  | "fulfillment"
  | "checkout";

export type AgentStatus = "IDLE" | "THINKING" | "WORKING" | "WAITING" | "ERROR";

/** 0 manual · 1 recommend · 2 execute-with-approval · 3 bounded autonomy · 4 full autonomy */
export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

export interface AgentDefinition {
  id: AgentId;
  name: string;
  role: string;
  objective: string;
  /** System instructions used by the hosted-model provider. */
  instructions: string;
  tools: string[];
  permissions: Permission[];
  autonomy: AutonomyLevel;
  /** Daily spend authority in paise. 0 means the agent may not spend. */
  dailyBudgetPaise: number;
  color: string;
  /** Agents this one is allowed to delegate to. */
  delegatesTo: AgentId[];
}

export interface AgentRuntimeState {
  id: AgentId;
  status: AgentStatus;
  activity: string;
  lastActiveAt: string | null;
  budgetUsedPaise: number;
  tasksCompleted: number;
  tasksFailed: number;
  toolCalls: number;
  avgLatencyMs: number;
}

// ─── Permissions ─────────────────────────────────────────────────────────────

export type Permission =
  | "READ_PRODUCTS"
  | "READ_INVENTORY"
  | "READ_ORDERS"
  | "READ_CUSTOMERS"
  | "READ_CUSTOMER_PII"
  | "READ_CAMPAIGNS"
  | "READ_SUPPLIERS"
  | "READ_FINANCE"
  | "READ_ANALYTICS"
  | "READ_COMPETITORS"
  | "READ_TICKETS"
  | "WRITE_PRICES"
  | "WRITE_INVENTORY"
  | "WRITE_PURCHASE_ORDERS"
  | "WRITE_REFUNDS"
  | "WRITE_CAMPAIGNS"
  | "WRITE_TICKETS"
  | "WRITE_PLANS"
  | "WRITE_FULFILLMENT"
  | "WRITE_ORDERS";;

// ─── Governance ──────────────────────────────────────────────────────────────

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type PolicyDecision = "ALLOW" | "REQUIRE_APPROVAL" | "DENY";

export interface GovernanceReason {
  check: "SCHEMA" | "PERMISSION" | "POLICY" | "RISK" | "BUDGET";
  decision: PolicyDecision;
  policyId?: string;
  message: string;
}

export interface BudgetSnapshot {
  limitPaise: number;
  usedPaise: number;
  remainingPaise: number;
}

export interface GovernanceResult {
  decision: PolicyDecision;
  risk: RiskLevel;
  reasons: GovernanceReason[];
  financialImpactPaise: number;
  budget: BudgetSnapshot | null;
}

export interface PolicyRule {
  id: string;
  category: "financial" | "pricing" | "marketing" | "inventory" | "security";
  description: string;
  /** Human-readable limit, rendered in the policy UI. */
  limit: string;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export interface ToolContext {
  agentId: AgentId;
  taskId: string | null;
  correlationId: string;
  /** Set when the call is replaying an already-approved action. */
  approvalId?: string;
}

export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  input: ZodType<I>;
  output: ZodType<O>;
  permission: Permission;
  /** Static risk, or computed from the validated input. */
  risk: RiskLevel | ((input: I) => RiskLevel);
  /** True when the tool changes business state; read-only tools skip approval. */
  mutates: boolean;
  /** Money the action moves, in paise. Drives budget + policy checks. */
  financialImpactPaise?: (input: I) => number;
  execute: (input: I, ctx: ToolContext) => O | Promise<O>;
}

export interface ToolCallRecord {
  id: string;
  toolName: string;
  agentId: AgentId;
  input: unknown;
  output: unknown;
  governance: GovernanceResult;
  status: "COMPLETED" | "DENIED" | "PENDING_APPROVAL" | "FAILED";
  error?: string;
  latencyMs: number;
  createdAt: string;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export type EventType =
  | "ORDER_CREATED"
  | "ORDER_CANCELLED"
  | "PAYMENT_SUCCESS"
  | "PAYMENT_FAILED"
  | "INVENTORY_LOW"
  | "INVENTORY_OUT"
  | "PRICE_CHANGED"
  | "CAMPAIGN_PERFORMANCE_CHANGED"
  | "CUSTOMER_RETURN_CREATED"
  | "REFUND_REQUESTED"
  | "SUPPLIER_DELAYED"
  | "PURCHASE_ORDER_CREATED"
  | "CUSTOMER_MESSAGE_RECEIVED"
  | "REVENUE_ANOMALY"
  | "COMPETITOR_PRICE_CHANGED"
  | "DEMAND_SPIKE"
  | "FULFILLMENT_REQUESTED"
  | "FULFILLMENT_SUBMITTED"
  | "FULFILLMENT_FAILED"
  | "FULFILLMENT_DEAD_LETTERED"
  // An AI buyer placed a machine cart. Distinct from ORDER_CREATED, which the
  // fulfilment plan owns and which means a paid human order.
  | "MACHINE_ORDER_CREATED"
  // Internal lifecycle events, used by the live UI.
  | "AGENT_STATUS_CHANGED"
  | "AGENT_MESSAGE"
  | "TASK_STATUS_CHANGED"
  | "TOOL_CALLED"
  | "APPROVAL_REQUESTED"
  | "APPROVAL_RESOLVED"
  | "PLAN_CREATED"
  | "PLAN_COMPLETED"
  | "GOAL_PROGRESS";

export interface BusinessEvent<P = Record<string, unknown>> {
  id: string;
  type: EventType;
  payload: P;
  source: string;
  correlationId: string;
  createdAt: string;
}

export type EventHandler = (event: BusinessEvent) => void | Promise<void>;

// ─── Tasks, plans, goals ─────────────────────────────────────────────────────

export type TaskStatus =
  | "PENDING"
  | "PLANNING"
  | "RUNNING"
  | "WAITING_FOR_AGENT"
  | "WAITING_FOR_APPROVAL"
  | "EXECUTING"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "BLOCKED";

export const TERMINAL_TASK_STATUSES: TaskStatus[] = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
];

export interface AgentTask {
  id: string;
  planId: string;
  agentId: AgentId;
  title: string;
  /** Task ids that must complete before this one runs. */
  dependsOn: string[];
  status: TaskStatus;
  attempts: number;
  result: AgentResult | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Plan {
  id: string;
  goalId: string | null;
  title: string;
  trigger: string;
  status: TaskStatus;
  correlationId: string;
  createdAt: string;
  finishedAt: string | null;
  /** Whether the LLM produced this task graph, or the deterministic fallback did. */
  plannedBy: "model" | "template";
  /** The model's reasoning, or why its plan was rejected. */
  planNote: string | null;
}

export interface BusinessGoal {
  id: string;
  statement: string;
  metric: GoalMetric;
  targetPercent: number;
  constraints: string[];
  deadlineDays: number;
  baselineValue: number;
  currentValue: number;
  status: "ACTIVE" | "ACHIEVED" | "ABANDONED";
  createdAt: string;
}

export type GoalMetric =
  | "profit"
  | "revenue"
  | "conversion"
  | "stockouts"
  | "refund_rate"
  | "margin"
  | "repeat_rate";

// ─── Agent output ────────────────────────────────────────────────────────────

/**
 * Every agent separates what it measured from what it concluded.
 * `observed` entries are computed by deterministic code; `inference` and
 * `narrative` may come from a model.
 */
export interface AgentResult {
  agentId: AgentId;
  headline: string;
  observed: Evidence[];
  inference: string[];
  recommendations: Recommendation[];
  narrative: string;
  /** Which engine produced `inference` / `narrative`. */
  engine: EngineLabel;
  latencyMs: number;
}

export interface Evidence {
  label: string;
  value: string;
  /** Optional supporting delta, e.g. "-7.2% vs 7-day average". */
  detail?: string;
}

export interface Recommendation {
  id: string;
  agentId: AgentId;
  title: string;
  rationale: string;
  /** The tool this recommendation would invoke, if accepted. */
  tool: string | null;
  input: Record<string, unknown> | null;
  estimatedImpactPaise: number;
  confidence: number;
  risk: RiskLevel;
}

export type EngineLabel =
  | "Deterministic Business Engine"
  | `Hosted model · ${string}`;

// ─── Approvals ───────────────────────────────────────────────────────────────

export interface Approval {
  id: string;
  agentId: AgentId;
  toolName: string;
  input: Record<string, unknown>;
  title: string;
  reason: string;
  entityType: string;
  entityId: string;
  financialImpactPaise: number;
  risk: RiskLevel;
  policyId: string | null;
  expectedOutcome: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  taskId: string | null;
  correlationId: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

// ─── Commerce entities ───────────────────────────────────────────────────────

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  brand: string;
  description: string;
  costPaise: number;
  pricePaise: number;
  competitorPricePaise: number;
  rating: number;
  createdAt: string;
}

export interface InventoryItem {
  productId: string;
  sku: string;
  name: string;
  onHand: number;
  reserved: number;
  reorderPoint: number;
  supplierId: string;
  leadTimeDays: number;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  segment: "new" | "returning" | "premium" | "at_risk";
  ltvPaise: number;
  ordersCount: number;
  createdAt: string;
}

export interface Order {
  id: string;
  customerId: string;
  status: "PLACED" | "PAID" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "RETURNED";
  channel: "web" | "mobile" | "app";
  totalPaise: number;
  costPaise: number;
  paymentStatus: "SUCCESS" | "FAILED" | "REFUNDED";
  createdAt: string;
}

export interface OrderItem {
  orderId: string;
  productId: string;
  quantity: number;
  unitPricePaise: number;
}

// ─── Fulfillment ─────────────────────────────────────────────────────────────

/**
 * Dropshipping lifecycle, kept on `fulfillments` rather than on `orders`.
 * `orders.status` feeds the revenue arithmetic the whole analysis rests on;
 * widening its vocabulary would change numbers, not just labels.
 */
export type FulfillmentStatus =
  | "PENDING_SUPPLIER"
  | "SUBMITTED"
  | "SHIPPED"
  | "EXCEPTION"
  | "CANCELLED";

export interface Fulfillment {
  id: string;
  orderId: string;
  /** The supplier's own identifier, once it has accepted the order. */
  externalId: string | null;
  supplier: string;
  status: FulfillmentStatus;
  trackingUrl: string | null;
  attempts: number;
  lastError: string | null;
  /** True when no live supplier is configured and the submission was simulated. */
  simulated: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Job queue ───────────────────────────────────────────────────────────────

export type JobStatus = "READY" | "RUNNING" | "DONE" | "DEAD";

export interface QueuedJob<P = Record<string, unknown>> {
  id: string;
  kind: string;
  payload: P;
  status: JobStatus;
  attempts: number;
  lastError: string | null;
  /** Epoch milliseconds; a job is invisible to the worker until this passes. */
  runAfter: number;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  qualityScore: number;
  reliabilityScore: number;
  leadTimeDays: number;
  minimumOrderQuantity: number;
}

export interface SupplierQuote {
  supplierId: string;
  supplierName: string;
  productId: string;
  unitCostPaise: number;
  leadTimeDays: number;
  minimumOrderQuantity: number;
  qualityScore: number;
  reliabilityScore: number;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  productId: string;
  quantity: number;
  unitCostPaise: number;
  totalPaise: number;
  status: "DRAFT" | "PLACED" | "DELAYED" | "RECEIVED" | "CANCELLED";
  expectedAt: string;
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  channel: "search" | "social" | "email" | "display";
  status: "ACTIVE" | "PAUSED";
  dailyBudgetPaise: number;
  spendPaise: number;
  revenuePaise: number;
  clicks: number;
  impressions: number;
  conversions: number;
}

export interface DailyMetric {
  day: string;
  sessions: number;
  /** Accumulated from real order rows, along with revenue, COGS and refunds. */
  orders: number;
  revenuePaise: number;
  cogsPaise: number;
  adSpendPaise: number;
  refundsPaise: number;
  /**
   * Failed payment *attempts*, not failed orders. One shopper retrying a card
   * five times is five attempts and at most one order row, which is why this
   * number is far larger than the failure count in `getChannelBreakdown`.
   * Unlike revenue and orders, it is an independent counter rather than
   * something derived from the order table.
   */
  mobilePaymentFailures: number;
  /** Independent counter, like `mobilePaymentFailures`. */
  returns: number;
}

export interface Ticket {
  id: string;
  customerId: string;
  orderId: string | null;
  subject: string;
  body: string;
  status: "OPEN" | "ANSWERED" | "ESCALATED";
  reply: string | null;
  createdAt: string;
}

// ─── Audit ───────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  createdAt: string;
  agentId: string;
  action: string;
  entityType: string;
  entityId: string;
  input: unknown;
  output: unknown;
  policyResult: PolicyDecision;
  approvalRequired: boolean;
  approvalStatus: string | null;
  risk: RiskLevel;
  executionStatus: "COMPLETED" | "DENIED" | "PENDING_APPROVAL" | "FAILED";
  correlationId: string;
}

// ─── Memory ──────────────────────────────────────────────────────────────────

export type MemoryKind = "working" | "episodic" | "semantic" | "operational" | "policy";

export interface MemoryRecord {
  id: string;
  agentId: AgentId | "system";
  kind: MemoryKind;
  content: string;
  /** Lowercased tokens used for retrieval scoring. */
  terms: string;
  importance: number;
  createdAt: string;
}

// ─── AI gateway ──────────────────────────────────────────────────────────────

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StructuredRequest<T> {
  /** Identifies the deterministic fallback to use when no model is configured. */
  kind: string;
  system: string;
  user: string;
  schema: ZodType<T>;
  /** Deterministic result, always computed, used verbatim in offline mode. */
  fallback: () => T;
}

export interface AIProvider {
  readonly label: EngineLabel;
  readonly available: boolean;
  structured<T>(request: StructuredRequest<T>): Promise<{ value: T; engine: EngineLabel }>;
  text(messages: AIMessage[], fallback: () => string): Promise<{ value: string; engine: EngineLabel }>;
}
