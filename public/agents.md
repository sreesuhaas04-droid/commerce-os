# Meridian Commerce — Machine Buyer Guide

This merchant is transactable by AI buyers. Everything a buying agent needs is
on this page. Human-facing docs live at `/`.

## How to buy, end to end

1. **Read the catalogue** — `GET /api/catalog` returns products with ids,
   prices (integer paise, currency INR), availability and lead times. Query
   params: `category`, `inStock=true`, `limit` (max 200). No credential needed.
2. **Get a credential** — your operator creates an account at `/login` and
   issues you a scoped API key (`catalog:read`, `checkout:write`). The key is
   shown once and stored only as a SHA-256 hash; lose it and a new one is
   issued, the old one revoked.
3. **Talk to the merchant's Checkout Agent** — `POST /api/checkout` with
   `Authorization: Bearer <key>` and a typed buyer turn (see below). The agent
   recommends, carts and takes payment through the merchant's governed tools —
   it cannot invent a product, a price or a stock figure. Your `buyerId` is
   the account behind the key; you cannot act as another buyer.
4. **Payment** — the cart comes back `PENDING_PAYMENT` with a payment context.
   Confirming payment is a separate, human-gated action: every money move at
   this merchant is explainable, bounded and audited, and a machine purchase
   is no exception. Your buyer's cart parks in the merchant's approval queue
   with its full decision trace, and executes only when a human approves it.

## The checkout protocol

`POST /api/checkout` — one request is one buyer turn, authenticated:

```json
{ "intent": "browse",  "query": "laptop for programming" }
{ "intent": "cart",   "productIds": ["prd_001"] }
{ "intent": "confirm","machineOrderId": "mord_..." }
```

Send `Authorization: Bearer sk_live_…`. A `buyerId` field is optional and, if
present, must equal the account the key belongs to — a credential cannot act
as another buyer.

Rules the merchant enforces on you:

- One open cart per `buyerId`. Placing a new cart cancels your previous
  unpaid one.
- Carts are checked against real stock before placement — a shortfall is
  refused with a per-line breakdown.
- No cart above the hard ceiling (₹5,00,000) is accepted, ever.
- An unpaid cart is not a purchase. Do not tell your user it is.

## What you will NOT get

- Cost, margin or supplier identity — those are the merchant's private
  economics. Asking for them via the catalog gets you nothing.
- Customer PII. No API here returns another customer's data.
- A way to move money without an audit trail. Every action — including
  yours — lands in the merchant's audit log with its governance verdict.

## Payments

The merchant runs Razorpay **test mode** for machine purchases: payment
orders are created on Razorpay's sandbox with test keys (`rzp_test_*`), where
no real money can move. Live keys are refused by code. Without credentials,
payment references are simulated and identified as `TXN_DEMO_*` — always
labelled as such, never presented as real.

## Auth

The machine-buyer surface (`/api/checkout`) authenticates with a scoped API
key: `Authorization: Bearer sk_live_…`. Keys are issued and revoked by a
signed-in operator at `/login`, stored hashed, and carry exactly
`catalog:read` + `checkout:write` — a key can read the catalogue and
transact, nothing else. The human console sits behind the deployment's
password gate as before; accounts are the buyer-side credential.
