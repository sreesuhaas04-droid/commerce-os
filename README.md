# Multi-Agent Commerce OS

An operating layer for an online business, where **nine** specialised AI agents
observe events, investigate with typed tools, collaborate on findings, and
execute actions under a governance pipeline that decides — deterministically —
what they may do alone and what needs a human.

It is not a chatbot over a dashboard. Agents cannot touch the database; they
can only call declared tools, and every tool call passes permission, policy,
risk and budget checks before anything changes.

**The merchant is transactable by an AI buyer end to end.** An external buying
agent reads `/agents.md` and `/api/catalog`, then transacts through
`/api/checkout` — browse, cart, pay — where every money action goes through the
same governance pipeline a refund or a purchase order does. Payments run on
Razorpay **test mode** when credentials are set, and are simulated and labelled
`TXN_DEMO_*` when they are not.
```bash
git clone <repo> && cd commerce-os
npm install
npm run dev
```

Open <http://localhost:3000>. No API key, no database setup, no cloud account, no local
model. The demo business seeds itself on first request.

A deployed instance runs at **<https://commerce-os-phdo.onrender.com>** behind a shared
password. It is the same code; the local run is the one the demo script is written for,
because it needs no network.

---

## What it does

Watch the loop run end to end:

| | |
| --- | --- |
| **Observe** | A business event lands on the bus — a stockout, a revenue anomaly, a competitor price move. |
| **Understand** | The Analytics Agent decomposes revenue into traffic × conversion × AOV and isolates the driver. |
| **Plan** | The orchestrator matches the event to a task DAG and assigns each task to an agent. |
| **Delegate** | Inventory sizes a reorder and hands it to Procurement, which compares suppliers. |
| **Execute** | Tools run behind governance. Low-risk actions execute; anything above the limits parks. |
| **Verify** | Results are checked for evidence, and the business position is re-measured. |
| **Learn** | Conclusions are written to agent memory and retrieved by relevance on later runs. |

### Try this first

Type into the command bar on the dashboard:

> **Why did sales drop yesterday?**

Five agents run. The Analytics Agent finds a −29% conversion movement, traces it to a
mobile payment failure rate of 4.5% against 1.6% elsewhere, and rules out order value
as a cause. Inventory and Pricing clear their own domains. The Customer Agent finds
four tickets sharing one theme and calls it systemic. The CEO Agent ranks everything
and names the top priority.

None of that is scripted. It is computed from 2,124 seeded orders.

---

## Architecture

```
                          ┌─────────────────────────────┐
                          │        Command Center       │
                          │   Next.js App Router + SSE  │
                          └──────────────┬──────────────┘
                                         │
   INTELLIGENCE           ┌──────────────▼──────────────┐
                          │        Orchestrator         │
                          │  deterministic plan DAG     │
                          │  + task state machine       │
                          └──────────────┬──────────────┘
    ┌─────────┬─────────┬─────────┬───┼───┬─────────┬─────────┬─────────┐
    ▼         ▼         ▼         ▼       ▼         ▼         ▼         ▼
   CEO   Analytics Inventory  Pricing Marketing Customer Procurement Fulfilment
    └─────────┴─────────┴─────────┴───┼───┴─────────┴─────────┴─────────┘
                                         │ typed tool calls only
   GOVERNANCE             ┌──────────────▼──────────────┐
                          │     Governance Pipeline     │
                          │  schema → permission →      │
                          │  policy → risk → budget     │
                          └──────────────┬──────────────┘
                                         │ ALLOW / REQUIRE_APPROVAL / DENY
   EXECUTION              ┌──────────────▼──────────────┐
                          │        Tool Registry        │
                          └──────────────┬──────────────┘
              ┌──────────────┬───────────┴────┬──────────────┐
              ▼              ▼                ▼              ▼
         SQLite DB      Event Bus        Audit Log      Agent Memory
```

The three layers are enforced by module boundaries: agents import the tool registry and
never the database; tools import the database and never an agent.

Full detail in [docs/architecture.md](docs/architecture.md).

---

## The agents

| Agent | Owns | Autonomy | Spend authority |
| --- | --- | --- | --- |
| **CEO** | Synthesis, conflict resolution, priority | 3 | — |
| **Analytics** | Root-cause analysis, anomaly detection | 3 | — |
| **Inventory** | Stock cover, velocity, reorder sizing | 3 | — |
| **Pricing** | Margin defence, competitive position | 3 | — |
| **Marketing** | ROAS, budget reallocation | 2 | ₹10,000/day |
| **Customer** | Tickets, refunds, systemic signals | 3 | ₹20,000/day |
| **Procurement** | Supplier selection, purchase orders | 2 | ₹50,000/day |
| **Fulfilment** | Dropship handover, supplier exceptions | 3 | ₹1,00,000/day |
| **Checkout** | Conversational checkout for AI buyers | 2 | — |

Each has its own objective, system instructions, tool surface and permission set.
Permissions are the source of truth — the governance pipeline reads them on every call,
so an agent cannot reach a capability it was not granted even if a model asks for it by
name. See [docs/agents.md](docs/agents.md).

---

## Governance

Five checks, one result, no model involvement:

```
schema → permission → policy → risk → budget
```

| Policy | Limit |
| --- | --- |
| `FIN-001` Refund auto-approval | ₹2,000 — above this, a human decides |
| `FIN-002` Purchase order auto-approval | ₹50,000 |
| `FIN-003` Hard ceiling | ₹5,00,000 — denied outright, not approvable |
| `PRC-001` Minimum gross margin | 25% |
| `PRC-002` Maximum price step | 10% per change |
| `MKT-001` Daily budget movement | ₹10,000 |
| `INV-001` Reorder point change | ±200 units |
| `FUL-001` Supplier retry limit | 3 attempts, then dead-lettered |
| `FUL-002` Fulfilment auto-approval | ₹50,000 at supplier cost |
| `BUD-001` Per-agent daily spend | Agent's own budget |

Merged into one pipeline deliberately: when policy, risk and budget are separate
subsystems, a call can satisfy one and silently skip another.

The full rule set and its rationale: [docs/policies.md](docs/policies.md).

---

## Honesty rules

The system never claims a model did something it did not.

- **The engine badge in the header** names the active reasoning engine at all times.
  Without a key it reads **Demo mode — Deterministic Business Engine**.
- **Every agent result** carries the engine that produced its reasoning.
- **Every number** — margin, ROAS, forecast, profit, policy decision — is computed by
  deterministic code. A model never produces a figure, in either mode.
- **Projections are labelled `ESTIMATED`** and name their model (constant-elasticity,
  weighted moving average).
- **Payments and ad platforms are simulated.** Transaction IDs are `TXN_DEMO_*`. No
  external service is contacted and no money moves.
- **Fulfilment is simulated unless a supplier is configured**, and identified as
  `SUP_DEMO_*` when it is. With Printful credentials set it submits real orders — as
  **drafts**, which are never charged and never fulfilled. Confirming a draft is a
  separate API call this system does not implement, so no agent can cause a charge.
- **What a customer is told about their order** comes from that order's fulfilment state
  or is not said at all. No invented couriers, trace numbers or delivery dates.
- **Unmeasured funnel stages say "not instrumented"** rather than showing a plausible
  invention.

---

## Local AI, and why there is none

The original design called for a local model as the default provider. That was dropped:
it contradicts the one-command setup, it puts a multi-GB model on the developer's
machine, and small local models are unreliable at multi-step structured tool-calling —
flaky in exactly the moment a live demo cannot afford it.

Instead:

```
AIGateway
├── HostedProvider          primary — OpenAI-compatible HTTP, free tiers
└── DeterministicProvider   fallback — no network, no key, no local compute
```

The model **plans as well as reasons**: it builds the task DAG deciding which
agents run and in what order. Its plan is accepted only after passing seven
checks (schema, known agents, unique keys, resolvable dependencies, acyclic,
size bounds, terminal synthesis step) — a cycle would hang the executor forever.
Anything failing falls back to the fixed templates, and the plan records
`planned_by` so a fallback is never shown as model output. See ADR-016.

Measured on Groq's free tier with `llama-3.3-70b-versatile`: 4–8s per full run,
every agent reasoning on the model, roughly 2 in 3 runs model-planned. Plans
differ between runs — that is inherent to model-driven orchestration.

`HostedProvider` speaks the OpenAI-compatible chat shape, so Groq, Google Gemini and
OpenRouter free tiers all work through one adapter. Set `AI_BASE_URL`, `AI_API_KEY` and
`AI_MODEL` to enable it. On any error, timeout or schema mismatch it falls back to the
deterministic engine and the UI says so.

**What changes with a model connected:** prose quality, hypothesis ranking, customer
replies. **What does not change:** every figure, every policy decision, every plan.

---

## Running it

### Install

```bash
npm install     # ~360 packages, no native compilation
npm run dev     # http://localhost:3000
```

Requires **Node 24+** — the database uses the built-in `node:sqlite`, so there is no
native module to compile and no database server to run.

### Commands

| | |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | 165 tests — governance, security, auth, agents, agentic commerce, scenarios, MCP, queue, fulfilment, the password gate |
| `npm run typecheck` | Strict TypeScript, no `any` in domain code |
| `npm run seed` | Seed if empty |
| `npm run reset-demo` | Wipe and reseed to the exact starting state |
| `npm run mcp` | MCP server exposing the governed tools over stdio |

### Environment

Everything is optional — see [.env.example](.env.example). With no `.env` file the
system runs fully offline.

---

## Fulfilment

The one path in this system that reaches outside the process, so it is the one built to
assume the outside world fails.

```
Fulfillment Agent → fulfill_order → governance → fulfillments row (PENDING_SUPPLIER)
                                                        │
                                                   job_queue row
                                                        │
                                             worker → SupplierGateway → vendor
                                                        │
                                         3 failures, exponential backoff
                                                        ▼
                                          dead letter + EXCEPTION on the fulfilment
```

**The tool commits intent; the worker makes the call.** Network latency never enters the
executor, and a failed submission retries instead of vanishing. **One order is handed
over once** — a second request returns the existing fulfilment rather than shipping
twice. **Large fulfilments stop for a human** under `FUL-002`, at supplier cost rather
than customer price.

`SupplierGateway` is the seam, and it follows the same shape as the AI gateway: a
deterministic implementation that always works offline, and a live one used only when
credentials are present. Without them, submissions are recorded locally and identified
as `SUP_DEMO_*` — the UI and the tool output both say so, and no supplier is contacted.

### Printful

Set the `PRINTFUL_*` values in [.env.example](.env.example) and orders are submitted to
Printful for real, returning Printful's own order id.

**Draft orders only, enforced in code.** Printful creates orders in draft, and its
documentation is explicit that drafts "won't be charged, and they won't be picked up by
our fulfillment facilities". Confirming a draft is a separate API call that
`integrations/printful.ts` deliberately does not implement — there is no path from an
agent to a garment being printed or a card being charged, and a test asserts the request
never mentions confirmation. There is no Printful sandbox; drafts in a live account are
the honest equivalent, which is why that guarantee is a property of the code rather than
of a test endpoint.

Two simplifications, stated rather than hidden: every seeded SKU maps to one configured
catalog variant, because a generated catalogue has no real Printful equivalent; and the
recipient is a fixed address you configure, never a customer's — `SupplierOrderRequest`
cannot carry customer data, so the PII that `SEC-001` restricts cannot reach a vendor.

Failures are classified rather than blindly retried: a 429 waits exactly as long as
Printful's `retry-after` header asks, a 5xx or timeout retries with backoff, and a 4xx is
dead-lettered immediately because sending the same rejected request again cannot help.

---

## MCP server

The same tools the internal agents use are exposed to external agents over the Model
Context Protocol, on the stdio transport:

```bash
claude mcp add commerce-os -- npm --prefix /path/to/commerce-os run mcp
```

An external client is **not** privileged. The server binds to one agent identity —
`MCP_AGENT_ID`, defaulting to `analytics`, which holds only read permissions — and every
call goes through the same `callTool` pipeline an internal agent uses:

```
MCP client → tools/call → schema → permission → policy → risk → budget → execute → audit
```

So an MCP client bound to `procurement` raising a ₹1,00,000 purchase order gets this back,
and nothing executes:

```json
{ "status": "PENDING_APPROVAL", "decision": "REQUIRE_APPROVAL",
  "approvalId": "apr_…", "note": "Parked for human approval. Nothing has executed." }
```

The item appears in the human approval queue at `/approvals` with its full decision trace,
exactly as an internal agent's would. The governance verdict rides along with successful
calls too — a client that only ever saw outputs could not tell a checked action from an
unchecked one. Calls are correlated under an `mcp_…` id, so the audit log distinguishes
an external caller from an internal agent.

`tools/list` returns only the bound agent's surface, with input schemas generated from
the same Zod definitions the executor validates against, so the schema a client reads cannot
drift from the schema enforced. There is no MCP SDK dependency: `initialize`,
`tools/list`, `tools/call` and a line reader is less code than adding one.

---

## Agentic commerce: transactable by an AI buyer

A buying agent can take this merchant from discovery to a paid cart with three
HTTP calls, and every money action on that path is gated exactly like a human
agent's:

```
GET  /agents.md          machine buyer guide (also served at /agents.md)
GET  /api/catalog        agent-readable catalogue: id, price, availability
POST /api/checkout       one buyer turn: browse | cart | confirm
```

**The catalogue is a shop window, not the books.** Cost, margin and supplier
identity never appear in it — a buyer sees what a shopper in the shop sees.
The same builder backs the internal `get_agent_catalog` tool, so the two
cannot drift.

**Checkout is conversational and typed.** A turn names its intent; the
Checkout Agent serves it with grounded tool calls only — no invented products,
no invented totals, no stock claims the catalogue does not support.

**Every money action is gated.** Cart placement and payment confirmation both
park for a human under the agent's autonomy level, carry the exact cart and
total in the approval queue, and land in the audit log with their governance
verdict. A cart above the ₹5,00,000 hard ceiling is denied before any payment
order is created. A cart for more than is on the shelf is refused with a
per-line breakdown — the failure handled gracefully. An already-paid order
cannot be confirmed twice.

**Payments run Razorpay test mode.** Set `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET` and `RAZORPAY_TEST_MODE=1` (test keys only — the code
refuses `rzp_live_*`) and payment orders are created on Razorpay's sandbox,
where no real money can move. Unset, payment references are simulated and
identified as `TXN_DEMO_*`. The integration implements orders and payment
reads only: no settlement, no payout, no transfer.

**Checkout is authenticated, and keys are scoped.** The machine-buyer money API
requires a session (an operator at `/login`) or a Bearer API key. Keys carry
exactly `catalog:read` + `checkout:write`, are shown once and stored as
SHA-256 digests, and the `buyerId` of every turn is bound to the account
behind the credential — a key cannot act as another buyer. Failed logins are
rate-limited and audited; passwords are scrypt-hashed with per-account salt.
Manage keys at **`/login`** (also linked in the sidebar as *Account & Keys*).

**Upsell and campaign orchestration are grounded too.** The
`draft_upsell_offers` tool proposes cross-sells from the real catalogue —
same category, in stock, not already in the cart — and the growth plan
template pairs Marketing's campaign ranking with the Checkout Agent's
offers, so a campaign never carries an offer a buyer cannot transact.

---

## Deploying

Commerce OS runs as **one persistent Node process**. The SQLite file, the in-process
event bus and the open SSE stream all live in the same instance — so any host that keeps
a process alive works unmodified, and serverless does not (an event published in one
instance never reaches an SSE stream held by another).

### Locally

```bash
npm run build
npm start           # http://localhost:3000
```

This is what [docs/demo.md](docs/demo.md) is written for, and it needs no network.

### Container — Render, Fly.io, Railway, any VM

```bash
docker build -t commerce-os .
docker run -p 3000:3000 commerce-os
```

Node 24 is a hard requirement, not a preference: the database uses the built-in
`node:sqlite`, which does not exist in Node 20 or 22. `engines` in `package.json`
declares it so a host doesn't silently pick an older runtime and crash on boot.

**No volume is required.** The seed is deterministic, so a fresh container comes up with
the byte-identical dataset. Mount one at `/app/data` only if approvals and audit rows
should survive a restart — otherwise a restart behaves exactly like pressing
**Reset demo**.

**Exactly one instance.** The event bus, the SSE stream and the queue worker all live
inside the process. A second instance forks the bus and runs every queued fulfilment
twice, so pin the instance count wherever you deploy — `numInstances: 1` on Render,
`--max-instances=1` on Cloud Run.

### Render

[`render.yaml`](render.yaml) is a blueprint: **New → Blueprint → this repo**, then set
`DEMO_PASSWORD` in the dashboard. Free instances sleep after ~15 minutes idle and take
about a minute to wake, so a cold link makes a visitor wait.

### Google Cloud Run

```bash
gcloud run deploy commerce-os --source . \
  --max-instances=1 --min-instances=1 \
  --set-env-vars DEMO_PASSWORD=...
```

`--max-instances=1` for the reason above; `--min-instances=1` keeps it warm, which is
the difference between a link that responds instantly and one that cold-starts in front
of a judge. Needs a billing account even inside the free allowance.

### Protecting a public deployment

This console has no user accounts and its buttons approve money and reset the business,
which is fine on a laptop and not fine on a public URL. Set `DEMO_PASSWORD` and
[`proxy.ts`](proxy.ts) puts the whole site behind one shared password over HTTP Basic —
the browser draws the prompt, so there is no login page to build. `/api/health` stays
open so a platform health check does not read a 401 as a dead instance and roll the
deployment back.

Unset, the gate is off entirely and local development is untouched.

It is a demo gate, not an authentication system: one shared password, and the cookie it
sets holds that password rather than a signed session token. It stops a passer-by
approving a ₹2,00,000 purchase order. It is not built to withstand an attacker.

### Vercel and other serverless platforms

Not supported as-is, and the gap is architectural rather than configuration:

1. **SQLite would have to become hosted Postgres.** `DatabaseAdapter` in
   `database/db.ts` is the seam — deliberately narrow — but every query in
   `database/queries.ts` and all 29 tables need porting.
2. **The in-process event bus does not survive multiple instances.** SSE would need
   replacing with a durable queue or polling.

Both are real work, and both cost the zero-external-service property that makes this
project reproducible for free. Use a container host instead.

---

## The demo

**One click:** Simulator → **Start hackathon demo**. Seven narrated steps, 5–7 minutes:
baseline → three injected faults → investigation → supply response → fulfilment →
governance → verification.

**Eight scenarios**, each a real deterministic data change that publishes an event:
stockout · revenue drop · competitor price drop · campaign failure · supplier delay ·
payment failure · demand spike · return surge.

**Reset demo** in the header restores the exact seeded state — the dataset comes from
one seed (`20240115`), so every machine and every reset produces identical figures.

Presenter script: [docs/demo.md](docs/demo.md).

---

## Data

Deterministically generated: 50 products · 500 customers · 2,124 orders over 30 days ·
10 suppliers · 8 campaigns · 12 support tickets · 30 days of daily metrics.

**Revenue, orders, COGS and refunds are accumulated from the generated order rows**,
which is what lets the revenue decomposition reconcile arithmetically. Sessions, failed
payment *attempts* and returns are independent counters — a shopper retrying a card five
times produces five attempts and at most one order row, so those two numbers are not
meant to match, and the tools that return them say which they are. The most recent day
carries a deliberate, discoverable fault: a mobile checkout regression. No agent knows
about it; they find it by querying the data.

---

## Zero cost

| Concern | Choice | Cost |
| --- | --- | --- |
| Hosting | Local, or any Node host | ₹0 |
| Database | `node:sqlite`, file on disk | ₹0 |
| Event bus | In-process, `globalThis` singleton | ₹0 |
| Vector search | Deterministic local scoring | ₹0 |
| AI | Deterministic engine; optional free-tier key | ₹0 |
| Payments | Simulator | ₹0 |
| Monitoring | Metrics table + observability page | ₹0 |

No Docker, no Redis, no Postgres, no Kafka, no cloud account, no model weights. One
Node process and a ~2 MB SQLite file.

---

## Not implemented

Stated plainly, because a fake would violate the honesty rules above:

- **Visual product search.** Requires a vision model; there is no honest implementation
  without one, so it is absent rather than faked.
- **Supabase / Postgres adapter.** `DatabaseAdapter` is the seam; only SQLite ships.
- **Redis event bus.** `EventBus` is the seam; only the in-process bus ships.
- **A2A and agent payment protocols.** `CommerceAdapter` is designed as the seam.
  Nothing claims to speak them today. MCP *is* implemented — see above — over stdio
  only; there is no HTTP/SSE MCP transport. The AI-buyer surface below is a plain
  JSON API an external agent calls over HTTP, not a named protocol — deliberately,
  since UAP/ACP/x402 are all still moving.
- **Real payment settlement.** Razorpay test mode creates payment orders and reads
  payment status; no settlement, payout or transfer is implemented, and live keys
  are refused by code. Ad-platform integration remains simulated and labelled.
- **Confirming a Printful order.** The supplier integration is real and creates draft
  orders; the call that confirms one — the call that would cause production and a charge —
  is deliberately not implemented. See ADR-021.
- **Shipping to the actual customer.** A live supplier receives a fixed operator address,
  because `SupplierOrderRequest` cannot carry customer data. A real dropshipping business
  would need that decision taken deliberately, against `SEC-001`.
- **Authentication for the human console.** Accounts, sessions and scoped API
  keys exist and gate the machine-buyer API (`/api/checkout`, `/api/auth/*`,
  see `/login`); the operator console pages still sit behind the single shared
  `DEMO_PASSWORD` gate, and that gate remains a demo gate, not an
  authentication system.

---

## Documentation

| | |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Layers, data flow, module boundaries |
| [docs/agents.md](docs/agents.md) | Each agent's role, tools, permissions, reasoning |
| [docs/security.md](docs/security.md) | Threat model, prompt injection, permissions |
| [docs/security-review.md](docs/security-review.md) | The audit that found and fixed the loopholes |
| [docs/policies.md](docs/policies.md) | Every rule and why it exists |
| [docs/demo.md](docs/demo.md) | Presenter script |
| [docs/decisions.md](docs/decisions.md) | Architecture decisions and what was rejected |
| [docs/implementation-plan.md](docs/implementation-plan.md) | Original plan and spec critique |

---

## Licence

MIT.
