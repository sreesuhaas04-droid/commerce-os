# Security review — AI growth & agentic commerce track

Date: 3 September 2026 · Scope: the AI-buyer surface (`/api/catalog`,
`/api/checkout`, the Checkout Agent, the payments gateway) plus a full pass
over the existing governance pipeline with a machine-buyer's threat model.

Findings are numbered to continue the SEC series in `docs/policies.md`. Each
one states the loophole, the fix, and where the fix is asserted.

---

## Fixed in this pass

### SEC-002 — daily budgets never rolled over

**The hole.** `agents.budget_used_paise` is documented as a *daily* spend
counter, but nothing ever reset it. On day two, an agent that had spent its
full authority on day one had zero remaining — permanently, for every
spending agent, after enough days. The demo hid this because resets were
frequent and days short.

**Impact.** A soft denial of service on the business side: not an attacker
gain, but every large action parks for a human forever — and the BUD-001
policy the whole budget story rests on was fiction after day one.

**Fix.** `rolloverBudgets()` in `database/queries.ts` clears the counters once
per calendar day, guarded by a `system_state` day key and re-checked inside
the transaction so two concurrent calls cannot double-roll. `getAgentBudget`
and `chargeBudget` both pass through it.

**Tests.** `tests/security.test.ts` — "resets an agent's daily spend when the
day changes", "does not reset twice within the same day".

### SEC-003 — an approved refund could be issued twice

**The hole.** The executor's duplicate-approval guard keys on (tool, entity),
which stops one *pending* duplicate — not two approvals that differ in amount
or reason, or an approved refund followed by a second plan's refund on the
same order. `recordRefund` updated the order's payment status without ever
checking it. A refunded order could be refunded again; each approval moved
money.

**Impact.** Direct financial loss, twice per exploited order, through the
front door of the approval queue — the human approves two legitimate-looking
requests.

**Fix.** Three layers, each independent:
1. `recordRefund` transitions the order `SUCCESS|FAILED → REFUNDED`
   conditionally and refuses if the transition does not happen (the write
   itself is idempotent).
2. `create_refund` refuses an order already refunded with a readable message.
3. `fulfill_order` refuses CANCELLED and RETURNED orders — previously a
   refunded-but-still-`SUCCESS`-status order could be shipped after the
   money went back.

**Tests.** `tests/security.test.ts` — "refuses a second refund…", "never
hands an unpaid or refunded order to the supplier".

### SEC-007 — purchase-order receipt could mint unlimited stock

**The hole.** `receive_purchase_order` took a `purchaseOrderId` and a
`quantity` and credited stock, but never verified: that the PO exists, that it
was for the given product, that the quantity matched, or that it had not
already been received. Calling it repeatedly with a large quantity minted
stock out of thin air — no money moved, but the inventory every other agent
reasons over became fiction.

**Fix.** The tool now verifies existence, product match, quantity match and
PLACED/DELAYED status; `markPurchaseOrderReceived` performs the
once-only status transition in the same transaction as the stock credit.

**Tests.** `tests/security.test.ts` — "refuses to receive a purchase order
twice…", "refuses a receipt whose quantity does not match".

### SEC-006 — no rate limit on the plan-running routes

**The hole.** `/api/ask`, `/api/agents/[id]/run` and `/api/events/simulate`
each run a full agent pipeline (5–8 agent runs, model calls, DB writes) per
request. Behind the one shared password there are no accounts, so a stuck
client — a retry loop or a script with the demo password — could monopolise
the single process indefinitely.

**Fix.** A fixed-window per-IP limiter in `lib/api.ts` (in-process, matching
the single-instance deployment requirement): 20/min for plan runs, 30/min for
agent runs, 20/min for scenarios, with 429 + Retry-After.

### SEC-004 — audit filter passed arbitrary values to SQL

**The hole.** `/api/audit` forwarded raw `risk` and `status` query params into
the query. They were bound parameters (no injection), but an attacker could
probe for valid enum values and receive different result shapes — a small
information leak, and the kind of unvalidated input that rots into a real
hole.

**Fix.** The route validates `risk` and `status` against the known sets and
ignores unknown values.

---

## Design guarantees on the new AI-buyer surface

These are the properties the track's bar demands — every money action
explainable, bounded and gated — and where each is enforced.

| Property | Enforcement | Assertion |
| --- | --- | --- |
| A machine cart is gated | Checkout Agent autonomy 2: placement and confirm both park for a human | agentic-commerce tests: "parks for a human…" |
| The ceiling bounds machine carts | FIN-003 applies via the tool's declared financial impact; denial happens before any payment order is created | "refuses a cart above the hard ceiling…" (gateway call count = 0) |
| Stock claims are real | Cart placement checks per-line stock and refuses with a breakdown | "refuses a cart for more than is on the shelf…" |
| Payment confirms once | `markMachineOrderPaid` is the only `PAID` transition, once-only | "is the only transition into PAID, and only once" |
| One open cart per buyer | `createMachineOrder` cancels the previous unpaid cart transactionally | "keeps one open cart per buyer…" |
| The buyer sees no private economics | Catalog builder emits no cost/supplier/margin fields | "shows a buyer price and availability, never cost or suppliers" |
| Live keys are refused | `razorpayFromEnv` rejects `rzp_live_*` and requires `RAZORPAY_TEST_MODE=1` | "refuses a live key…" |
| Every step is audited | All checkout tools go through `callTool`; entity ids include the buyer session | "records every step of a machine purchase…" |

### The failure handled gracefully

The stock shortfall: a buyer agent asking for more than is on the shelf gets
a per-line refusal — `SKU-1040 (3 wanted, 0 on hand)` — from the tool, which
the agent surfaces as prose rather than an opaque error. The second half of
the same guarantee: confirming an already-paid order is refused as "not
awaiting payment", never charged twice.

---

## Known, accepted risks (unchanged from the original review)

1. **The shared password gates the human console pages.** `proxy.ts` remains a
   demo gate for the operator UI; the cookie carries the password itself.
   **Update:** the machine-buyer money API no longer relies on it —
   `/api/checkout` authenticates with accounts (scrypt passwords, opaque
   revocable sessions) and scoped Bearer API keys (`catalog:read`,
   `checkout:write`), hashed at rest, buyer-bound, and every auth event is
   audited. See `lib/auth.ts` and `tests/auth.test.ts`. The human pages
   behind `DEMO_PASSWORD` are unchanged and still a demo gate.
2. **One process.** The event bus, SSE and queue worker live in one Node
   process; a second instance doubles fulfilment jobs. Deployment docs pin
   `numInstances: 1`.
3. **`/api/health` is open by design.** Platform health checks that get a 401
   roll a deployment back. The route exposes boot time and commit only.
4. **In-process rate limiting** (SEC-006 fix) resets on restart and is per
   instance — consistent with the single-instance requirement, but not a
   defence against a distributed attacker. Fine for a demo console; a real
   deployment would front it with a platform-level limiter.
5. **MCP over stdio only.** No HTTP/SSE MCP transport exists, so the MCP
   surface's exposure is whoever can run the process.

---

## Razorpay integration posture

`integrations/payments.ts` follows the Printful rule: the code guarantees the
safe mode. Specifically:

- **Test keys only, and only when `RAZORPAY_TEST_MODE=1`.** A live key is
  treated as unconfigured, not armed.
- **Orders and payments reads only.** No settlement, payout or transfer
  endpoint is implemented, so no code path can move real money even with a
  compromised key set.
- **The base URL is a constant**, not configurable — no env var can redirect
  payment traffic to an attacker's host.
- **Timeouts on every request** (10s), so a hung processor cannot hold a
  checkout turn.
- Payment status is read from the processor's response, never assumed:
  a cart is `PENDING_PAYMENT` until `confirm_machine_payment` succeeds, and
  that tool refuses anything not awaiting payment.

---

## Addendum: the account system (auth pass)

The login page and credential APIs added in this pass, and what each is
enforced to do — every claim asserted in `tests/auth.test.ts`.

### Accounts
- Passwords: scrypt (N=16384 default), 64-byte output, 16-byte random salt per
  account, stored `salt$hash` hex. Verification is `timingSafeEqual`, so a
  wrong password costs the same as a right one. No route ever returns or logs
  the password — the test serialises the whole audit log and greps.
- Login is enumeration-safe: unknown email and wrong password return the same
  status, same body, byte-for-byte. Rate-limited 10/min/IP; signup 5/min/IP.
- Sessions: 256-bit random tokens in an httpOnly, SameSite=Lax cookie whose
  secure flag follows the scheme; 7-day TTL; server-side rows so sign-out
  deletes the token and it is dead immediately, not at expiry.

### API keys
- Shape `sk_live_<192 bits base64url>`. The row stores a SHA-256 digest and a
  12-char display prefix; the plaintext exists in exactly one HTTP response.
  A database leak therefore cannot mint a working key.
- Scopes are a closed set (`catalog:read`, `checkout:write`). Keys cannot mint
  or revoke keys — only a session can (`403` asserted). Revocation is
  immediate and audited; a revoked key answers `401` on the next call.

### The buyer binding
`/api/checkout` forces the turn's `buyerId` to the account behind the
credential. A caller supplying a different buyerId gets `403` — a credential
cannot act as another buyer, which is the agent-commerce equivalent of
session fixation. Unauthenticated calls get `401` with how to authenticate.

### Audit
Signup, login, failed login, logout, key issue, key revoke — each writes an
audit row with a correlation id. Failed logins store only a salted digest of
the attempted email, never the address, so the log cannot become a list of
who uses this system.
