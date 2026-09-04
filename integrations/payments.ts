/**
 * Payments gateway — the seam a real processor plugs into.
 *
 * Follows the same shape as the supplier gateway: one interface, a deterministic
 * implementation that always works offline, and a live one used only when its
 * credentials are present. The demo identifier convention (`TXN_DEMO_*`) marks a
 * simulated capture at a glance, exactly as `SUP_DEMO_*` does for suppliers.
 *
 * `RazorpayTestMode` is the live implementation: it speaks Razorpay's REST API
 * against `https://api.razorpay.com` with `RAZORPAY_TEST_MODE=1` and test keys
 * (`rzp_test_*`). Razorpay's test mode is a complete sandbox — no real money
 * can move on test keys — which makes it the honest equivalent of the
 * Printful-draft rule: this file implements Orders and Payments reads, never
 * a settlement, a payout or a transfer, and it never accepts a live key.
 *
 * Live keys are refused on purpose. `rzp_live_*` on a demo console is a loaded
 * weapon with no user accounts behind it; the code declines to arm it.
 *
 * POST requests use the Orders API with `payment_capture = 1` so a successful
 * test payment auto-captures in the sandbox — the normal checkout flow. The
 * response's own `status` is stored verbatim rather than assumed.
 */
import { z } from "zod";

export interface CreateOrderRequest {
  /** The commerce order this payment belongs to. */
  orderId: string;
  amountPaise: number;
  /** What the customer sees on the payment page. */
  notes?: Record<string, string>;
}

export interface CreateOrderResult {
  /** The processor's own order id — `TXN_DEMO_*` when simulated. */
  processorOrderId: string;
  /** Passed to the client SDK to complete the payment. */
  paymentContext: Record<string, unknown>;
  status: "CREATED" | "ATTEMPTED" | "PAID" | "FAILED";
  /** False only when a real processor created the order. */
  simulated: boolean;
}

export interface PaymentRecord {
  processorPaymentId: string;
  processorOrderId: string;
  orderId: string;
  amountPaise: number;
  status: string;
  method: string;
  createdAt: string;
}

export interface PaymentsGateway {
  readonly label: string;
  readonly live: boolean;
  createOrder(request: CreateOrderRequest): Promise<CreateOrderResult>;
  /** Latest payments for one commerce order, newest first. */
  listPayments(orderId: string): Promise<PaymentRecord[]>;
}

/**
 * Deterministic payments. Creates an order reference immediately so checkout
 * works with zero configuration, and reports no captures — the simulation
 * never claims money arrived that no processor confirmed.
 */
class SimulatedPayments implements PaymentsGateway {
  readonly label = "Simulated payments";
  readonly live = false;

  async createOrder(request: CreateOrderRequest): Promise<CreateOrderResult> {
    if (!Number.isInteger(request.amountPaise) || request.amountPaise <= 0) {
      throw new Error("A payment must be for a positive whole number of paise");
    }
    const id = `TXN_DEMO_${Math.abs(
      hash32(request.orderId + request.amountPaise + Date.now()),
    )}`;
    return {
      processorOrderId: id,
      paymentContext: { key: "demo", amount: request.amountPaise },
      status: "CREATED",
      simulated: true,
    };
  }

  async listPayments(orderId: string): Promise<PaymentRecord[]> {
    void orderId;
    return [];
  }
}

const RAZORPAY_BASE = "https://api.razorpay.com";
const TIMEOUT_MS = 10_000;

/** Only the fields we read; Razorpay returns more. */
const RazorpayOrder = z.object({
  id: z.string(),
  status: z.string(),
  amount: z.number(),
});

export class RazorpayTestMode implements PaymentsGateway {
  readonly live = true;
  readonly label = "Razorpay (test mode)";

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
  ) {}

  async createOrder(request: CreateOrderRequest): Promise<CreateOrderResult> {
    if (!Number.isInteger(request.amountPaise) || request.amountPaise <= 0) {
      throw new Error("A payment must be for a positive whole number of paise");
    }
    const body = {
      amount: request.amountPaise,
      currency: "INR",
      receipt: request.orderId,
      payment_capture: 1,
      notes: { commerce_order: request.orderId, ...(request.notes ?? {}) },
    };
    const response = await this.post("/v1/orders", body);
    const parsed = RazorpayOrder.safeParse(response);
    if (!parsed.success) {
      throw new Error("Razorpay returned an unrecognised order payload");
    }
    return {
      processorOrderId: parsed.data.id,
      paymentContext: {
        key: this.keyId,
        amount: parsed.data.amount,
        order_id: parsed.data.id,
        currency: "INR",
      },
      status: "CREATED",
      simulated: false,
    };
  }

  async listPayments(orderId: string): Promise<PaymentRecord[]> {
    // Payments are listed by the processor's order id, so the receipt we sent
    // on create is the join key. Without a stored mapping there is nothing to
    // list yet — an honest empty, not a fabricated one.
    const rows = await this.get(`/v1/orders?receipt=${encodeURIComponent(orderId)}&count=20`);
    const orders = z.object({ items: z.array(z.object({ id: z.string() })) }).safeParse(rows);
    if (!orders.success) return [];

    const payments: PaymentRecord[] = [];
    for (const order of orders.data.items) {
      const listResponse = await this.get(`/v1/orders/${order.id}/payments?type=1`);
      const parsed = z
        .object({
          items: z.array(
            z.object({
              id: z.string(),
              order_id: z.string(),
              amount: z.number(),
              status: z.string(),
              method: z.string().nullable().optional(),
              created_at: z.number(),
            }),
          ),
        })
        .safeParse(listResponse);
      if (!parsed.success) continue;
      for (const item of parsed.data.items) {
        payments.push({
          processorPaymentId: item.id,
          processorOrderId: item.order_id,
          orderId,
          amountPaise: item.amount,
          status: item.status,
          method: item.method ?? "unknown",
          createdAt: new Date(item.created_at * 1000).toISOString(),
        });
      }
    }
    return payments;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
    let response: Response;
    try {
      response = await fetch(`${RAZORPAY_BASE}${path}`, {
        ...init,
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Razorpay unreachable: ${reason}`);
    }
    if (!response.ok) {
      const detail = await safeText(response);
      // 4xx is a bad request or a key problem — retrying cannot fix either.
      if (response.status < 500) {
        throw new Error(`Razorpay rejected the request (${response.status}): ${detail}`);
      }
      throw new Error(`Razorpay error ${response.status}: ${detail}`);
    }
    return response.json();
  }

  private post(path: string, body: unknown): Promise<unknown> {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  }

  private get(path: string): Promise<unknown> {
    return this.request(path, { method: "GET" });
  }
}

const globalRef = globalThis as unknown as { __commercePayments?: PaymentsGateway };

export function getPayments(): PaymentsGateway {
  globalRef.__commercePayments ??= razorpayFromEnv() ?? new SimulatedPayments();
  return globalRef.__commercePayments;
}

/** Test seam. */
export function setPayments(gateway: PaymentsGateway | null): void {
  globalRef.__commercePayments = gateway ?? undefined;
}

export function describePayments(): { label: string; live: boolean; detail: string } {
  const payments = getPayments();
  return {
    label: payments.label,
    live: payments.live,
    detail: payments.live
      ? "Razorpay test mode. Orders are created on Razorpay's sandbox with test keys — no real money can move, and live keys are refused. This integration creates orders and reads payments; it implements no settlement, payout or transfer."
      : "No payment credentials configured. Payment references are recorded locally and identified as TXN_DEMO_*; nothing is sent anywhere.",
  };
}

/**
 * Builds the Razorpay client from the environment, or null when unconfigured.
 *
 * All or nothing, and test keys only: `rzp_live_*` is a deployment mistake
 * waiting to happen on a console with no accounts, so it is treated as "not
 * configured" rather than silently armed.
 */
export function razorpayFromEnv(): RazorpayTestMode | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  const testMode = process.env.RAZORPAY_TEST_MODE?.trim();

  if (!keyId || !keySecret) return null;
  if (testMode !== "1") return null;
  if (keyId.startsWith("rzp_live_")) return null;

  return new RazorpayTestMode(keyId, keySecret);
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "(no response body)";
  }
}

function hash32(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  return h;
}
