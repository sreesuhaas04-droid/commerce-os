"use client";

/**
 * The landing page — the pitch, in one scroll.
 *
 * Unlike the showcase (a deep, interactive walk through the running system),
 * the landing page is the front door: what this is, why now, how it works,
 * and one honest sentence about what is real. Every number rendered here is
 * passed in from the server against the live database — the same honesty rule
 * as the rest of the console, because a landing page that invents its proof
 * points would undercut the exact claim this product makes.
 *
 * Sections:
 *   1. Topbar — brand glyph, three doors (showcase, console, sign in)
 *   2. Hero — the 3D neural core, the claim, dual CTA, live telemetry
 *   3. Stats band — measured, from the database
 *   4. Why now — the protocol race in four beats
 *   5. How it works — three numbered steps of the machine-buyer flow
 *   6. What's inside — six capability cards
 *   7. The bar — the track's bar, quoted, with the proof
 *   8. Final CTA + footer
 */

import Link from "next/link";
import { NeuralCore } from "@/components/neural-core";
import { Reveal, ScrollProgress } from "@/components/scroll-fx";
import { formatMoney } from "@/lib/money";

export interface LandingStats {
  agents: number;
  products: number;
  orders: number;
  auditRows: number;
  policies: number;
  tests: number;
  pendingApprovals: number;
  ceilingPaise: number;
  engine: string;
}

/** The brand mark from the design brief, inline so it inherits nothing. */
function BrandGlyph({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect width="40" height="40" rx="12" fill="#18181B" stroke="#A3E635" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="10" stroke="#FFFFFF" strokeDasharray="2 3" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="4" fill="#A3E635" />
      <rect x="19" y="8" width="2" height="4" fill="#A3E635" />
      <rect x="19" y="28" width="2" height="4" fill="#A3E635" />
      <rect x="8" y="19" width="4" height="2" fill="#FFFFFF" />
      <rect x="28" y="19" width="4" height="2" fill="#FFFFFF" />
    </svg>
  );
}

// ─── 1–2: Topbar + Hero ───────────────────────────────────────────────────────

function Hero({ stats }: { stats: LandingStats }) {
  return (
    <>
      {/* Topbar */}
      <header className="sticky top-0 z-50 border-b" style={{ borderColor: "var(--lg-line)", background: "rgba(9,9,11,0.75)", backdropFilter: "blur(24px)" }}>
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-8">
          <div className="flex items-center gap-3">
            <BrandGlyph size={32} />
            <div className="flex flex-col">
              <span className="text-[15px] font-bold tracking-tight" style={{ fontFamily: "var(--lg-font-display)" }}>
                Commerce OS
              </span>
              <span className="lg-label" style={{ color: "var(--lg-dim)" }}>
                AI growth · agentic commerce
              </span>
            </div>
          </div>
          <nav className="flex items-center gap-2 sm:gap-3">
            <Link href="/showcase" className="lg-btn-glass" style={{ padding: "8px 16px" }}>
              Showcase
            </Link>
            <Link href="/" className="lg-btn-glass" style={{ padding: "8px 16px" }}>
              Console
            </Link>
            <Link href="/login" className="lg-btn-primary" style={{ padding: "8px 18px" }}>
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex min-h-[88vh] w-full items-center justify-center overflow-hidden px-4 py-20 sm:px-8">
        <NeuralCore className="absolute inset-0 h-full w-full" />
        <div className="lg-grid-lines" />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(80% 70% at 50% 45%, transparent 30%, #09090b 88%)" }}
        />

        <Reveal className="relative z-10 flex max-w-4xl flex-col items-center gap-8 text-center">
          <div className="lg-pill">
            <span className="lg-led lg-led-pulse" />
            <span style={{ color: "var(--lg-lime)" }}>
              NPCI UAP era · Razorpay test-mode rails · live now
            </span>
          </div>

          <h1
            className="text-[36px] font-semibold leading-[1.06] tracking-[-0.035em] sm:text-[48px] lg:text-[60px]"
            style={{ fontFamily: "var(--lg-font-display)" }}
          >
            Make any merchant
            <br />
            <span className="lg-hero-text">sellable to AI buyers.</span>
          </h1>

          <p className="max-w-2xl text-[15px] leading-relaxed sm:text-[17px]" style={{ color: "var(--lg-muted)" }}>
            Nine specialised agents run the business. AI buyers transact through a
            conversational, governed checkout. Every money action — theirs and the
            agents&#39; — is explainable, bounded and gated, in code.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/showcase" className="lg-btn-primary">
              See it live →
            </Link>
            <Link href="/login" className="lg-btn-glass">
              Create an account
            </Link>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <span className="lg-label" style={{ color: "var(--lg-dim)" }}>
              <span className="lg-led" style={{ display: "inline-block", marginRight: 6 }} />
              {stats.agents} agents
            </span>
            <span className="lg-label" style={{ color: "var(--lg-dim)" }}>
              <span className="lg-led lg-led-blue" style={{ display: "inline-block", marginRight: 6 }} />
              {stats.products} SKUs transactable
            </span>
            <span className="lg-label" style={{ color: "var(--lg-dim)" }}>
              <span className="lg-led" style={{ display: "inline-block", marginRight: 6 }} />
              {stats.auditRows.toLocaleString()} audited actions
            </span>
          </div>
        </Reveal>
      </section>
    </>
  );
}

// ─── 3: Stats band ───────────────────────────────────────────────────────────

function Stat({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="lg-panel flex flex-col gap-1 p-5 text-center">
      <span className="text-[26px] font-bold tracking-[-0.03em] sm:text-[30px]" style={{ fontFamily: "var(--lg-font-display)" }}>
        {value}
      </span>
      <span className="lg-label" style={{ color: "var(--lg-muted)" }}>{label}</span>
      {hint && <span className="text-[10px]" style={{ color: "var(--lg-dim)" }}>{hint}</span>}
    </div>
  );
}

function StatsBand({ stats }: { stats: LandingStats }) {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-8">
      <Reveal>
        <div className="mb-6 flex items-center gap-3">
          <span className="lg-label" style={{ color: "var(--lg-lime)" }}>{"// measured, not asserted"}</span>
          <span className="h-px flex-1" style={{ background: "var(--lg-line)" }} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Stat value={String(stats.agents)} label="Governed agents" hint="each with its own autonomy" />
          <Stat value={String(stats.products)} label="Live SKUs" hint="agent-readable catalog" />
          <Stat value={stats.orders.toLocaleString()} label="Seeded orders" hint="30 days of history" />
          <Stat value={String(stats.policies)} label="Policy rules" hint="deterministic, no model asked" />
          <Stat value={String(stats.tests)} label="Tests passing" hint="governance & security asserted" />
          <Stat value={formatMoney(stats.ceilingPaise)} label="Hard ceiling" hint="denied outright, not approvable" />
        </div>
      </Reveal>
    </section>
  );
}

// ─── 4: Why now ──────────────────────────────────────────────────────────────

const WHY_NOW = [
  { tag: "INDIA", title: "NPCI UAP", body: "The sovereign agent-payments spec is closing, and in-app pilots are already live. The merchant side is the open surface." },
  { tag: "OPEN", title: "ACP · AP2 · x402", body: "Global protocols racing to define agent-to-agent commerce. None has won; the seam matters more than the bet." },
  { tag: "BUYERS", title: "Agents that shop", body: "AI buyers are already choosing products and paying on behalf of humans. Merchants without a machine surface are invisible to them." },
  { tag: "TRUST", title: "The bar", body: "Autonomous commerce only ships when money actions are explainable, bounded and gated. That bar is the product." },
];

function WhyNow() {
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-16 sm:px-8">
      <Reveal className="flex flex-col gap-3">
        <span className="lg-label" style={{ color: "var(--lg-lime)" }}>{"// why now"}</span>
        <h2 className="max-w-3xl text-[28px] font-semibold tracking-[-0.03em] sm:text-[38px]" style={{ fontFamily: "var(--lg-font-display)" }}>
          Agent-to-agent commerce is the open problem of the year
        </h2>
      </Reveal>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {WHY_NOW.map((item, i) => (
          <Reveal key={item.title} delay={i * 90} className="lg-panel h-full p-6 transition-transform duration-300 hover:-translate-y-1">
            <span className="lg-label" style={{ color: "var(--lg-lime)" }}>{item.tag}</span>
            <h3 className="mb-2 mt-2 text-[18px] font-medium" style={{ fontFamily: "var(--lg-font-display)" }}>
              {item.title}
            </h3>
            <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--lg-muted)" }}>
              {item.body}
            </p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ─── 5: How it works ─────────────────────────────────────────────────────────

const STEPS = [
  {
    n: "01",
    title: "The agent reads the catalog",
    body: "GET /api/catalog serves product, price, availability and lead time — the same builder the internal governance checks, so the buyer's view can never drift from the merchant's.",
    code: `GET /api/catalog?inStock=true`,
  },
  {
    n: "02",
    title: "It talks the checkout",
    body: "Typed buyer turns — browse, cart, confirm — run the Checkout Agent, stock-checked and ceiling-bounded. Carts park for a human; an unpaid cart is never called bought.",
    code: `POST /api/checkout
{ "intent": "cart",
  "productIds": ["prd_002"] }`,
  },
  {
    n: "03",
    title: "A human opens the gate",
    body: "Every money action lands in the approval queue with its full decision trace and the audit log. The human approves; the payment records; the order becomes PAID — once.",
    code: `APPROVAL apr_… → APPROVED
machine order → PAID`,
  },
];

function HowItWorks() {
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-16 sm:px-8">
      <Reveal className="flex flex-col gap-3">
        <span className="lg-label" style={{ color: "var(--lg-lime)" }}>{"// the machine-buyer flow"}</span>
        <h2 className="text-[28px] font-semibold tracking-[-0.03em] sm:text-[38px]" style={{ fontFamily: "var(--lg-font-display)" }}>
          Three steps, end to end
        </h2>
      </Reveal>
      <div className="flex flex-col gap-4">
        {STEPS.map((step, i) => (
          <Reveal key={step.n} delay={i * 80} className="lg-panel flex flex-col gap-6 p-6 md:flex-row md:items-center md:p-8">
            <div className="flex items-center gap-4 md:w-56 md:shrink-0">
              <span
                className="text-[34px] font-bold tracking-[-0.04em]"
                style={{ fontFamily: "var(--lg-font-display)", color: "var(--lg-lime)" }}
              >
                {step.n}
              </span>
              <h3 className="text-[17px] font-medium leading-tight" style={{ fontFamily: "var(--lg-font-display)" }}>
                {step.title}
              </h3>
            </div>
            <p className="flex-1 text-[13.5px] leading-relaxed" style={{ color: "var(--lg-muted)" }}>
              {step.body}
            </p>
            <div className="lg-well p-4 md:w-72 md:shrink-0" style={{ borderRadius: 12 }}>
              <pre className="lg-code"><code>{step.code}</code></pre>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ─── 6: What's inside ────────────────────────────────────────────────────────

const FEATURES = [
  {
    title: "Conversational checkout",
    body: "An AI buyer transacts through typed turns against the Checkout Agent — every claim grounded in tool output, nothing invented.",
    accent: "var(--lg-lime)",
  },
  {
    title: "Agent-readable catalog",
    body: "A machine surface that shares its builder with internal governance. Cost, margin and suppliers never appear — a buyer sees a shop window, not the books.",
    accent: "var(--lg-blue)",
  },
  {
    title: "Upsell & cross-sell engine",
    body: "Offers drafted from the real catalog — same category, in stock, in bounds — so a campaign never carries an offer a buyer cannot transact.",
    accent: "var(--lg-lime)",
  },
  {
    title: "Campaign orchestrator",
    body: "Budget moves toward what returns it, bounded by the daily cap. Machine-order events reach the orchestrator like any demand signal.",
    accent: "var(--lg-blue)",
  },
  {
    title: "Bounded governance",
    body: "Schema → permission → policy → risk → budget on every tool call. Refund, purchase and fulfilment gates, a margin floor, and a hard ceiling nothing can cross.",
    accent: "var(--lg-amber)",
  },
  {
    title: "The full audit trail",
    body: "Every action — approved, parked or denied — logged with its governance verdict and correlation id. Failed logins included. Passwords never.",
    accent: "var(--lg-lime)",
  },
];

function Features() {
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-16 sm:px-8">
      <Reveal className="flex flex-col gap-3">
        <span className="lg-label" style={{ color: "var(--lg-lime)" }}>{"// what's inside"}</span>
        <h2 className="text-[28px] font-semibold tracking-[-0.03em] sm:text-[38px]" style={{ fontFamily: "var(--lg-font-display)" }}>
          One operating layer, nine agents, every action gated
        </h2>
      </Reveal>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature, i) => (
          <Reveal key={feature.title} delay={i * 70} className="lg-panel h-full p-6 transition-transform duration-300 hover:-translate-y-1">
            <div className="mb-3 flex items-center gap-2">
              <span className="lg-led" style={{ background: feature.accent }} />
              <span className="lg-label" style={{ color: "var(--lg-dim)" }}>
                {feature.title.toUpperCase()}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--lg-muted)" }}>
              {feature.body}
            </p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ─── 7: The bar ──────────────────────────────────────────────────────────────

function TheBar({ stats }: { stats: LandingStats }) {
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-16 sm:px-8">
      <Reveal className="lg-panel-2 relative overflow-hidden p-8 md:p-12">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(163,230,53,0.12), transparent 70%)" }}
        />
        <div className="flex flex-col gap-6">
          <span className="lg-label" style={{ color: "var(--lg-lime)" }}>{"// the bar, quoted"}</span>
          <blockquote
            className="max-w-3xl text-[20px] font-medium leading-snug tracking-[-0.02em] sm:text-[26px]"
            style={{ fontFamily: "var(--lg-font-display)" }}
          >
            “Every money action explainable, bounded and gated. Show the audit trail
            and one failure handled gracefully.”
          </blockquote>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="lg-well p-4" style={{ borderRadius: 12 }}>
              <div className="lg-label" style={{ color: "var(--lg-lime)" }}>EXPLAINABLE</div>
              <p className="mt-1 text-[12px]" style={{ color: "var(--lg-muted)" }}>
                {stats.auditRows.toLocaleString()} audit rows and counting — each with its governance verdict.
              </p>
            </div>
            <div className="lg-well p-4" style={{ borderRadius: 12 }}>
              <div className="lg-label" style={{ color: "var(--lg-lime)" }}>BOUNDED</div>
              <p className="mt-1 text-[12px]" style={{ color: "var(--lg-muted)" }}>
                Refunds, purchase orders and fulfilments each behind their own limit — and one hard ceiling.
              </p>
            </div>
            <div className="lg-well p-4" style={{ borderRadius: 12 }}>
              <div className="lg-label" style={{ color: "var(--lg-lime)" }}>GATED</div>
              <p className="mt-1 text-[12px]" style={{ color: "var(--lg-muted)" }}>
                A stock shortfall names the line that fell short. An already-paid order is refused, never re-charged.
              </p>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// ─── 8: Final CTA + footer ───────────────────────────────────────────────────

function FinalCta({ stats }: { stats: LandingStats }) {
  return (
    <>
      <section className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-8">
        <Reveal className="flex flex-col items-center gap-6">
          <span className="lg-pill">
            <span className="lg-led lg-led-pulse" />
            <span style={{ color: "var(--lg-lime)" }}>{stats.engine}</span>
          </span>
          <h2 className="text-[30px] font-semibold tracking-[-0.03em] sm:text-[40px]" style={{ fontFamily: "var(--lg-font-display)" }}>
            The merchant side of the agent era,
            <br />
            <span className="lg-hero-text">running right now.</span>
          </h2>
          <p className="max-w-xl text-[14px] leading-relaxed" style={{ color: "var(--lg-muted)" }}>
            Walk the live showcase, run a machine-buyer flow yourself, or sign in
            and issue the key your agent will carry.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/showcase" className="lg-btn-primary">
              Enter the showcase
            </Link>
            <Link href="/login" className="lg-btn-glass">
              Issue an API key
            </Link>
          </div>
        </Reveal>
      </section>

      <footer className="border-t px-6 py-6" style={{ borderColor: "var(--lg-line)" }}>
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 text-center md:flex-row md:text-left">
          <span className="lg-label" style={{ color: "var(--lg-dim)" }}>
            Payments: Razorpay test mode only — live keys refused by code
          </span>
          <span className="lg-label" style={{ color: "var(--lg-dim)" }}>
            Every figure on this page is read from the running database
          </span>
        </div>
      </footer>
    </>
  );
}

// ─── Assembly ────────────────────────────────────────────────────────────────

export function LandingPage({ stats }: { stats: LandingStats }) {
  return (
    <div className="showcase">
      <ScrollProgress />
      <Hero stats={stats} />
      <StatsBand stats={stats} />
      <WhyNow />
      <HowItWorks />
      <Features />
      <TheBar stats={stats} />
      <FinalCta stats={stats} />
    </div>
  );
}
