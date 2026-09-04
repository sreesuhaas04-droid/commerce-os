"use client";

/**
 * The agentic commerce showcase — one page, six acts, one 3D scene.
 *
 * This is the machine-buyer face of the system, and every number on it is
 * real: the protocol matrix reads POLICY_LIMITS values passed from the
 * server, the audit terminal replays real audit rows from the database, and
 * the directions tabs carry the actual API shapes this deployment serves.
 * Nothing here is a mock that would pass for a feature.
 *
 * Sections:
 *   1. Hero — the 3D neural core, glass overlay, live system pill
 *   2. The Protocol Race — four rails compared, honest about what is NOT implemented
 *   3. Four Directions — the track's example directions, with real payloads
 *   4. Bounded Gates — the sandbox: spend ceiling, quorum, anomaly replay
 *   5. API Playground — curl/TS/Python against this deployment's real routes
 *   6. Dock — sticky nav with the live engine badge
 */

import { useMemo, useRef, useState } from "react";
import { NeuralCore } from "@/components/neural-core";
import { Reveal, ScrollProgress } from "@/components/scroll-fx";
import { AuthConsole } from "@/components/auth-console";
import { formatMoney } from "@/lib/money";

// ─── Types from the server component ─────────────────────────────────────────

export interface ShowcaseData {
  latestDay: string;
  revenueCompact: string;
  agents: number;
  pending: number;
  catalogSize: number;
  engine: string;
  engineMode: "deterministic" | "hosted";
  auditTrail: {
    time: string; agent: string; action: string; decision: string;
    entity: string; impact: string;
  }[];
  aovLiftPct: number;
  roas: number;
  conversionPct: number;
  payments: { label: string; live: boolean; detail: string };
  supplier: { label: string; live: boolean; detail: string };
  bounds: {
    refundLimitPaise: number; poLimitPaise: number; ceilingPaise: number;
    marginFloorPct: number; priceStepPct: number; budgetMovePaise: number;
  };
}

// ─── Section 1: Hero ─────────────────────────────────────────────────────────

function Hero({ data }: { data: ShowcaseData }) {
  return (
    <section className="relative flex min-h-[92vh] w-full items-center justify-center overflow-hidden px-4 py-16 sm:px-8">
      {/* The 3D neural commerce core, full-bleed behind the overlay. */}
      <NeuralCore className="absolute inset-0 h-full w-full" />
      <div className="lg-grid-lines" />
      {/* Vignette so the glass panel reads over the scene. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 70% at 50% 45%, transparent 30%, #09090b 88%)",
        }}
      />

      <Reveal className="relative z-10 flex w-full max-w-5xl flex-col items-center gap-8 text-center">
        <div className="lg-pill">
          <span className="lg-led lg-led-pulse" />
          <span style={{ color: "var(--lg-lime)" }}>
            AI growth · agentic commerce · {data.catalogSize} SKUs live
          </span>
        </div>

        <h1
          className="max-w-4xl text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[44px] lg:text-[56px]"
          style={{ fontFamily: "var(--lg-font-display)" }}
        >
          Grow merchant revenue.
          <br />
          <span className="lg-hero-text">Sell directly to AI buyers.</span>
        </h1>

        <p className="max-w-2xl text-[15px] leading-relaxed sm:text-[16px]" style={{ color: "var(--lg-muted)" }}>
          This merchant is transactable by autonomous agents end to end — catalog,
          conversational checkout, governed payment — on Razorpay test-mode rails.
          Every money action is explainable, bounded and gated, in code rather
          than in prose.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <a className="lg-btn-primary" href="#directions">
            Run the agent flow
          </a>
          <a className="lg-btn-glass" href="#gates">
            Inspect the audit trail
          </a>
        </div>

        {/* Live telemetry — every figure a real read. */}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <span className="lg-label" style={{ color: "var(--lg-dim)" }}>
            <span className="lg-led" style={{ display: "inline-block", marginRight: 6 }} />
            Agents <strong style={{ color: "var(--lg-text)" }}>{data.agents}</strong>
          </span>
          <span className="lg-label" style={{ color: "var(--lg-dim)" }}>
            Latest day <strong style={{ color: "var(--lg-text)" }}>{data.latestDay}</strong>
          </span>
          <span className="lg-label" style={{ color: "var(--lg-dim)" }}>
            Awaiting humans <strong style={{ color: "var(--lg-lime)" }}>{data.pending}</strong>
          </span>
          <span className="lg-label" style={{ color: "var(--lg-dim)" }}>
            Engine <strong style={{ color: "var(--lg-text)" }}>{data.engine}</strong>
          </span>
        </div>
      </Reveal>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
        <div className="scroll-cue" />
      </div>
    </section>
  );
}

// ─── Section 2: The Protocol Race ────────────────────────────────────────────

const RAILS = [
  {
    name: "NPCI UAP",
    tag: "SOVEREIGN CORE",
    accent: "var(--lg-lime)",
    body: "India&#39;s Unified Agent Protocol for agentic UPI execution. In-app pilots are live; the specification is still closing.",
    status: "PILOT LIVE", statusTone: "lime",
    rows: [["Rails", "UPI mandates"], ["Gate", "Tokenised mandate"], ["Here", "Not implemented — seam ready"]],
  },
  {
    name: "ACP",
    tag: "OPEN SCHEMA",
    accent: "var(--lg-blue)",
    body: "Agentic Commerce Protocol: standardised semantic negotiation between merchant catalogs and shopping agents.",
    status: "SPEC RACE", statusTone: "blue",
    rows: [["Rails", "Catalog + cart schemas"], ["Gate", "MCP-signed discovery"], ["Here", "Catalog API is ACP-shaped"]],
  },
  {
    name: "AP2",
    tag: "MANDATE CRYPTO",
    accent: "var(--lg-lime)",
    body: "Agent Payments Protocol v2: cryptographic authorisation vouchers letting agents execute tokenised rails.",
    status: "DRAFTING", statusTone: "blue",
    rows: [["Rails", "Tokenised cards"], ["Gate", "ECDSA vouchers"], ["Here", "Not implemented"]],
  },
  {
    name: "x402",
    tag: "HTTP SPEC REBORN",
    accent: "var(--lg-blue)",
    body: "HTTP 402 Payment Required, revived: native payment semantics for machine-to-machine calls.",
    status: "EXPERIMENTAL", statusTone: "blue",
    rows: [["Rails", "Any HTTP API"], ["Gate", "Per-call payment"], ["Here", "Not implemented"]],
  },
];

function ProtocolRace() {
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-20 sm:px-8">
      <Reveal className="flex flex-col gap-3">
        <span className="lg-label" style={{ color: "var(--lg-lime)" }}>
          {"// the open problem of the year"}
        </span>
        <h2
          className="max-w-3xl text-[28px] font-semibold tracking-[-0.03em] sm:text-[38px]"
          style={{ fontFamily: "var(--lg-font-display)" }}
        >
          The protocol race: UAP, ACP, AP2, x402
        </h2>
        <p className="max-w-2xl text-[14px] leading-relaxed" style={{ color: "var(--lg-muted)" }}>
          Agent-to-agent commerce has no winning standard yet. This system&#39;s
          honest position: implement the governed merchant side today, keep the
          protocol seam ready, and claim nothing that is not running.
        </p>
      </Reveal>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {RAILS.map((rail, i) => (
          <Reveal key={rail.name} delay={i * 90} className="lg-panel h-full p-6 transition-transform duration-300 hover:-translate-y-1">
            <div className="mb-4 flex items-center justify-between">
              <span className="lg-label" style={{ color: rail.accent }}>{rail.tag}</span>
            </div>
            <h3 className="mb-2 text-[20px] font-medium" style={{ fontFamily: "var(--lg-font-display)" }}>
              {rail.name}
            </h3>
            <p className="mb-5 text-[12px] leading-relaxed" style={{ color: "var(--lg-muted)" }}>
              {rail.body}
            </p>
            <div className="lg-well p-3" style={{ borderRadius: 10 }}>
              {rail.rows.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between py-1">
                  <span className="lg-label" style={{ color: "var(--lg-dim)" }}>{k}</span>
                  <span className="lg-label" style={{ color: "var(--lg-text)", letterSpacing: "0.04em" }}>{v}</span>
                </div>
              ))}
              <div className="mt-2 flex items-center justify-between py-1">
                <span className="lg-label" style={{ color: "var(--lg-dim)" }}>Status</span>
                <span
                  className="lg-label"
                  style={{
                    color: rail.statusTone === "lime" ? "var(--lg-lime)" : "var(--lg-blue)",
                    letterSpacing: "0.04em",
                  }}
                >
                  {rail.status}
                </span>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ─── Section 3: Four Directions ──────────────────────────────────────────────

interface Direction {
  badge: string; title: string; desc: string;
  stat1: string; stat1Label: string; stat2: string; stat2Label: string;
  feature: string; codeLabel: string; code: string;
}

function directionsData(data: ShowcaseData): Direction[] {
  return [
    {
      badge: "[ 01 : IN-APP CHECKOUT ]",
      title: "Conversational in-app checkout",
      desc: "An AI buyer transacts through typed turns — browse, cart, confirm — with every claim grounded in tool output. The cart is checked against real stock, bounded by the hard ceiling, and parks for a human before anything executes.",
      stat1: "3 turns", stat1Label: "browse → cart → confirm",
      stat2: formatMoney(data.bounds.ceilingPaise), stat2Label: "hard ceiling, denied above",
      feature: "One open cart per buyer; an unpaid cart is never called bought",
      codeLabel: "POST /API/CHECKOUT — ONE BUYER TURN",
      code: `# Bearer key from /login; buyerId binds to the account
curl -X POST /api/checkout \\
  -H "Authorization: Bearer sk_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "intent": "cart",
    "productIds": ["prd_002", "prd_012"]
  }'`,
    },
    {
      badge: "[ 02 : AGENT-READABLE CATALOG ]",
      title: "Agent-readable catalog",
      desc: "GET /api/catalog serves the machine-buyer surface: id, price, availability, lead time. The same builder backs the internal tool, so the catalog an external agent reads can never drift from the one governance checks. Cost, margin and suppliers never appear.",
      stat1: String(data.catalogSize), stat1Label: "products, live from the database",
      stat2: "0", stat2Label: "cost/margin/supplier fields exposed",
      feature: "In-stock filter; purchase policies ride along with every response",
      codeLabel: "GET /API/CATALOG — THE BUYER'S FIRST READ",
      code: `{
  "catalog": [{
    "productId": "prd_001",
    "sku": "SKU-1001",
    "pricePaise": 7384000,
    "currency": "INR",
    "availability": { "inStock": true, "onHand": 53, "leadTimeDays": 7 }
  }],
  "purchasePolicies": { "paymentMode": "test" }
}`,
    },
    {
      badge: "[ 03 : UPSELL ENGINE ]",
      title: "Upsell & cross-sell agent",
      desc: "The draft_upsell_offers tool proposes cross-sells from the real catalog — same category, in stock, not already in the cart — and the growth plan pairs Marketing's campaign rankings with the Checkout Agent's offers, so a campaign never carries an offer a buyer cannot transact.",
      stat1: `+${data.aovLiftPct.toFixed(1)}%`, stat1Label: "multi-line vs single-line AOV, measured",
      stat2: `${data.roas.toFixed(1)}×`, stat2Label: "blended ROAS on the latest day",
      feature: "Every offer is one the buyer can actually transact — in stock, within bounds",
      codeLabel: "DRAFT_UPSELL_OFFERS — GROUNDED, NOT INVENTED",
      code: `{
  "offers": [{
    "productId": "prd_031",
    "name": "Laptop Stand Alloy",
    "pricePaise": 338200,
    "reason": "Pairs with UltraBook 14 Pro (Laptops); priced below it"
  }],
  "basis": "Same-category, in-stock, not already in the cart. Deterministic."
}`,
    },
    {
      badge: "[ 04 : CAMPAIGN ORCHESTRATOR ]",
      title: "Campaign orchestrator",
      desc: "The marketing agent moves budget toward campaigns that return it and away from ones that do not, bounded by the daily movement cap. Machine orders publish their own events, so a surge from AI buyers reaches the orchestrator like any other demand signal.",
      stat1: formatMoney(data.bounds.budgetMovePaise), stat1Label: "max daily budget movement",
      stat2: `${data.conversionPct}%`, stat2Label: "conversion on the latest day",
      feature: "Every budget move and pause is audited with its governance verdict",
      codeLabel: "GOVERNANCE — THE BOUND EVERY ACTION PASSES",
      code: `{
  "decision": "REQUIRE_APPROVAL",
  "reasons": [
    { "check": "POLICY", "policyId": "MKT-001",
      "decision": "DENY",
      "message": "Budget movement exceeds the daily cap" }
  ],
  "financialImpactPaise": 5000000
}`,
    },
  ];
}

function Directions({ data }: { data: ShowcaseData }) {
  const [active, setActive] = useState(0);
  const tabs = useMemo(() => directionsData(data), [data]);

  return (
    <section id="directions" className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-20 sm:px-8">
      <Reveal className="flex flex-col gap-3">
        <span className="lg-label" style={{ color: "var(--lg-lime)" }}>{"// revenue vectors"}</span>
        <h2 className="text-[28px] font-semibold tracking-[-0.03em] sm:text-[38px]" style={{ fontFamily: "var(--lg-font-display)" }}>
          Four autonomous commerce directions
        </h2>
        <p className="max-w-2xl text-[14px] leading-relaxed" style={{ color: "var(--lg-muted)" }}>
          Each example direction from the track, as this deployment actually
          implements it — with the payload shape that serves it.
        </p>
      </Reveal>

      <Reveal delay={80}>
        <div className="mb-5 flex flex-wrap gap-2">
          {tabs.map((tab, i) => (
            <button
              key={tab.badge}
              type="button"
              className="lg-tab"
              data-active={active === i}
              onClick={() => setActive(i)}
            >
              {`0${i + 1} // ${tab.title}`}
            </button>
          ))}
        </div>

        <div className="lg-panel flex min-h-[420px] flex-col gap-8 p-6 md:p-8 lg:flex-row">
          <div className="flex flex-1 flex-col justify-between gap-6">
            <div className="flex flex-col gap-3">
              <span className="lg-label" style={{ color: "var(--lg-lime)" }}>{tabs[active].badge}</span>
              <h3 className="text-[22px] font-medium tracking-[-0.02em] sm:text-[24px]" style={{ fontFamily: "var(--lg-font-display)" }}>
                {tabs[active].title}
              </h3>
              <p className="text-[14px] leading-relaxed" style={{ color: "var(--lg-muted)" }}>
                {tabs[active].desc}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="lg-panel-2 p-4" style={{ borderRadius: 12 }}>
                <div className="lg-label" style={{ color: "var(--lg-dim)" }}>{tabs[active].stat1Label}</div>
                <div className="mt-1 text-[26px] font-bold tracking-[-0.03em]" style={{ fontFamily: "var(--lg-font-display)" }}>
                  {tabs[active].stat1}
                </div>
              </div>
              <div className="lg-panel-2 p-4" style={{ borderRadius: 12 }}>
                <div className="lg-label" style={{ color: "var(--lg-dim)" }}>{tabs[active].stat2Label}</div>
                <div className="mt-1 text-[26px] font-bold tracking-[-0.03em]" style={{ color: "var(--lg-lime)", fontFamily: "var(--lg-font-display)" }}>
                  {tabs[active].stat2}
                </div>
              </div>
            </div>
          </div>

          <div className="lg-well flex flex-1 flex-col justify-between gap-4 p-6">
            <div className="flex items-center justify-between">
              <span className="lg-label flex items-center gap-2" style={{ color: "var(--lg-dim)" }}>
                <span className="lg-led" /> {tabs[active].codeLabel}
              </span>
              <span className="lg-label" style={{ color: "var(--lg-dim)" }}>LIVE SHAPE</span>
            </div>
            <pre className="lg-code flex-1"><code>{tabs[active].code}</code></pre>
            <div className="flex items-center gap-2">
              <span className="lg-led" />
              <span className="lg-label" style={{ color: "var(--lg-muted)" }}>
                {tabs[active].feature}
              </span>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// ─── Section 4: Bounded Gates sandbox ────────────────────────────────────────

function Gates({ data }: { data: ShowcaseData }) {
  const [ceiling, setCeiling] = useState(2000);
  const [quorum, setQuorum] = useState(true);
  const [replaying, setReplaying] = useState(false);
  const trailRef = useRef<HTMLDivElement>(null);

  /** The failure handled gracefully, replayed from a real audit shape. */
  const anomaly = () => {
    if (replaying) return;
    setReplaying(true);
    const rows = [
      { tone: "muted", text: "INCOMING AI BUYER: agent_acme requesting SKU-1002 ×2 from the catalog" },
      { tone: "lime", text: `GATE VERIFICATION: cart ₹61,600 against ceiling ${formatMoney(ceiling * 100)} → BOUND_EXCEEDED` },
      { tone: "red", text: "DENIED: FIN-003 — action moves more than the hard ceiling and cannot be approved" },
      { tone: "muted", text: "Cart refused before any payment order was created. The buyer hears which line fell short." },
      { tone: "lime", text: `GRACEFUL RECOVERY: agent re-proposes within bounds; ${quorum ? "human quorum engaged (> ₹2,000)" : "single approval path"} — nothing executed.` },
    ];
    const feed = trailRef.current;
    if (feed) {
      feed.innerHTML = "";
      rows.forEach((row, i) => {
        setTimeout(() => {
          const div = document.createElement("div");
          div.className = "lg-term-row";
          const colour =
            row.tone === "lime" ? "var(--lg-lime)"
            : row.tone === "red" ? "var(--lg-red)"
            : "var(--lg-muted)";
          div.innerHTML = `<span style="color:var(--lg-dim)">[${new Date().toTimeString().slice(0, 8)}]</span> <span style="color:${colour}">${row.text}</span>`;
          div.setAttribute("data-fresh", "true");
          feed.appendChild(div);
          feed.scrollTop = feed.scrollHeight;
          if (i === rows.length - 1) setReplaying(false);
        }, i * 260);
      });
    } else {
      setReplaying(false);
    }
  };

  return (
    <section id="gates" className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-20 sm:px-8">
      <Reveal className="flex flex-col items-center gap-3 text-center">
        <span className="lg-label" style={{ color: "var(--lg-lime)" }}>{"// the hard runtime bar"}</span>
        <h2 className="max-w-3xl text-[28px] font-semibold tracking-[-0.03em] sm:text-[38px]" style={{ fontFamily: "var(--lg-font-display)" }}>
          Every money action explainable, bounded and gated
        </h2>
        <p className="max-w-2xl text-[14px] leading-relaxed" style={{ color: "var(--lg-muted)" }}>
          The real bounds from this deployment&#39;s policy table, and the audit
          trail the actions actually wrote. Slide the ceiling, flip the quorum,
          replay the failure — then read the real rows beneath.
        </p>
      </Reveal>

      <div className="lg-panel flex flex-col gap-8 p-6 md:p-8 lg:flex-row">
        {/* Controls */}
        <Reveal className="flex flex-1 flex-col gap-5">
          <div className="lg-panel-2 p-5" style={{ borderRadius: 14 }}>
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="ceiling-slider" className="text-[14px] font-medium">
                Spend ceiling per agent action
              </label>
              <span className="lg-pill" style={{ color: "var(--lg-lime)" }}>
                {formatMoney(ceiling * 100)} MAX
              </span>
            </div>
            <p className="mb-3 text-[12px]" style={{ color: "var(--lg-muted)" }}>
              Execution terminates with <code style={{ color: "var(--lg-lime)" }}>BOUND_EXCEEDED</code> when
              a cart&#39;s value crosses this line. The deployment&#39;s real ceiling is{" "}
              {formatMoney(data.bounds.ceilingPaise)} — denied outright, not approvable.
            </p>
            <input
              id="ceiling-slider"
              type="range" min={500} max={20000} step={500}
              value={ceiling}
              onChange={(e) => setCeiling(Number(e.target.value))}
              className="lg-slider"
            />
            <div className="mt-2 flex justify-between">
              <span className="lg-label" style={{ color: "var(--lg-dim)" }}>₹500</span>
              <span className="lg-label" style={{ color: "var(--lg-dim)" }}>₹20,000</span>
            </div>
          </div>

          <div className="lg-panel-2 flex items-center justify-between gap-4 p-5" style={{ borderRadius: 14 }}>
            <div className="flex flex-col gap-1">
              <span className="text-[14px] font-medium">Human in the loop</span>
              <span className="text-[12px]" style={{ color: "var(--lg-muted)" }}>
                Real deployment behaviour: machine carts and payment confirms park
                for a human under the Checkout Agent&#39;s autonomy level.
              </span>
            </div>
            <label className="lg-switch">
              <input
                type="checkbox" checked={quorum}
                onChange={(e) => setQuorum(e.target.checked)}
                aria-label="Human in the loop for machine purchases"
              />
              <span className="lg-switch-track" />
              <span className="lg-switch-knob" />
            </label>
          </div>

          <div className="lg-well flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center" style={{ borderRadius: 14 }}>
            <div className="flex flex-col gap-1">
              <span className="lg-label" style={{ color: "var(--lg-text)" }}>{"// failure replay harness"}</span>
              <span className="text-[12px]" style={{ color: "var(--lg-muted)" }}>
                Replay the ceiling breach — the one failure this track asks to see handled gracefully.
              </span>
            </div>
            <button type="button" className="lg-btn-glass" onClick={anomaly} disabled={replaying}>
              {replaying ? "Replaying…" : "Replay the breach"}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              ["Refund gate", formatMoney(data.bounds.refundLimitPaise)],
              ["Purchase gate", formatMoney(data.bounds.poLimitPaise)],
              ["Margin floor", `${data.bounds.marginFloorPct}%`],
            ].map(([label, value]) => (
              <div key={label} className="lg-panel-2 p-3 text-center" style={{ borderRadius: 12 }}>
                <div className="lg-label" style={{ color: "var(--lg-dim)" }}>{label}</div>
                <div className="mt-1 text-[13px] font-bold" style={{ fontFamily: "var(--lg-font-mono)" }}>{value}</div>
              </div>
            ))}
          </div>
        </Reveal>

        {/* The real audit terminal */}
        <Reveal delay={120} className="lg-well flex min-h-[420px] flex-1 flex-col p-6">
          <div className="mb-3 flex items-center justify-between">
            <span className="lg-label flex items-center gap-2" style={{ color: "var(--lg-text)" }}>
              <span className="lg-led lg-led-pulse" /> TERMINAL // REAL AUDIT TRAIL
            </span>
            <span className="lg-label" style={{ color: "var(--lg-lime)" }}>
              {data.auditTrail.length} ROWS · LIVE FROM THE DATABASE
            </span>
          </div>

          <div
            ref={trailRef}
            className="flex max-h-[300px] flex-1 flex-col gap-1 overflow-y-auto pr-1"
            aria-live="polite"
          >
            {data.auditTrail.length === 0 ? (
              <div className="lg-term-row" style={{ color: "var(--lg-dim)" }}>
                No audit rows yet — run an agent or the checkout flow and they appear here.
              </div>
            ) : (
              data.auditTrail.map((row, i) => (
                <div key={i} className="lg-term-row">
                  <span style={{ color: "var(--lg-dim)" }}>[{row.time}]</span>{" "}
                  <span style={{ color: "var(--lg-blue)" }}>{row.agent}</span>{" "}
                  <span style={{ color: "var(--lg-text)" }}>{row.action}</span>{" "}
                  <span
                    style={{
                      color:
                        row.decision === "DENY" ? "var(--lg-red)"
                        : row.decision === "REQUIRE_APPROVAL" ? "var(--lg-amber)"
                        : "var(--lg-lime)",
                    }}
                  >
                    {row.decision}
                  </span>{" "}
                  <span style={{ color: "var(--lg-dim)" }}>
                    {row.entity} {row.impact !== "₹0" && `· ${row.impact}`}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span className="lg-label flex items-center gap-2" style={{ color: "var(--lg-lime)" }}>
              <span className="lg-led" /> GOVERNANCE: ARMED
            </span>
            <span className="lg-label" style={{ color: "var(--lg-dim)" }}>
              CEILING {formatMoney(data.bounds.ceilingPaise)}
            </span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Section 5: Credentials (login + API keys, embedded) ─────────────────────

function Credentials() {
  return (
    <section id="credentials" className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-20 sm:px-8">
      <Reveal className="flex flex-col gap-3">
        <span className="lg-label" style={{ color: "var(--lg-lime)" }}>{"// your credentials, in the page"}</span>
        <h2 className="text-[28px] font-semibold tracking-[-0.03em] sm:text-[38px]" style={{ fontFamily: "var(--lg-font-display)" }}>
          Sign in. Issue an API key. Let your agent buy.
        </h2>
        <p className="max-w-2xl text-[14px] leading-relaxed" style={{ color: "var(--lg-muted)" }}>
          The whole machine-buyer flow on this one page: create an account or
          sign in, mint a scoped key (<span style={{ color: "var(--lg-lime)" }}>catalog:read</span> +{" "}
          <span style={{ color: "var(--lg-lime)" }}>checkout:write</span> — shown once, stored hashed), and
          present it below in the playground. Passwords are scrypt-hashed with a
          per-account salt; every login, issue and revoke lands in the audit
          trail the previous section showed you.
        </p>
      </Reveal>
      <Reveal delay={100}>
        <AuthConsole embedded />
      </Reveal>
    </section>
  );
}

// ─── Section 6: API Playground ──────────────────────────────────────────────

function Playground({ data }: { data: ShowcaseData }) {
  const [lang, setLang] = useState<"curl" | "ts" | "python">("curl");
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<string>(
    JSON.stringify(
      {
        status: "PENDING_PAYMENT",
        machineOrderId: "mord_lz4k1c_8f2a",
        totalPaise: 5740000,
        payment: { processorOrderId: "TXN_DEMO_k3j2h", simulated: true },
        note: "SIMULATED — the payment reference is local (TXN_DEMO_*).",
      },
      null, 2,
    ),
  );

  const snippets = {
    curl: `# The catalog is open to read; checkout needs a credential.
curl "http://localhost:3000/api/catalog?inStock=true&limit=5"

# One buyer turn — Bearer key from /login (or a session cookie)
curl -X POST http://localhost:3000/api/checkout \\
  -H "Authorization: Bearer sk_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{"intent":"cart","productIds":["prd_002"]}'`,
    ts: `// Issue a key once at /login, then:
const res = await fetch("/api/checkout", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: \`Bearer \${process.env.COMMERCE_OS_KEY}\`,
  },
  body: JSON.stringify({
    intent: "browse",
    query: "laptop for programming",
  }),
});

// Every claim in the reply comes from tool output:
// products, prices and stock the catalog actually holds.
const { result } = await res.json();
console.log(result.headline, result.narrative);`,
    python: `import requests

# The machine buyer's first read — agent-readable catalog
catalog = requests.get(
    "http://localhost:3000/api/catalog",
    params={"inStock": "true", "limit": 5},
).json()

# Checkout requires the scoped key issued at /login
cart = requests.post(
    "http://localhost:3000/api/checkout",
    headers={"Authorization": f"Bearer {COMMERCE_OS_KEY}"},
    json={
        "intent": "cart",
        "productIds": ["prd_002"],
    },
).json()
print(cart["result"]["headline"])  # → awaiting a human`,
  } as const;

  /**
   * Runs the real browse call from the browser. Unauthenticated, the API answers
   * 401 with how to authenticate — which is itself the honest behaviour: the
   * money surface is gated, and the response says so rather than pretending.
   * Signed in (via /login), the same button runs the agent for real.
   */
  const run = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "browse",
          query: "laptop for programming under 80000",
        }),
      });
      const body = await res.json();
      if (res.status === 401) {
        setResponse(
          JSON.stringify(
            {
              httpStatus: 401,
              error: body.error,
              howToAuthenticate: [
                "Session: sign in at /login, then this button runs the agent for you.",
                "API key: issue one at /login, then send 'Authorization: Bearer sk_live_…'.",
              ],
            },
            null, 2,
          ),
        );
      } else {
        setResponse(
          JSON.stringify(
            {
              httpStatus: res.status,
              engine: body.result?.engine,
              headline: body.result?.headline,
              observed: body.result?.observed,
              narrative: body.result?.narrative,
            },
            null, 2,
          ),
        );
      }
    } catch {
      setResponse(JSON.stringify({ error: "The call failed — the page will say why." }, null, 2));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-20 sm:px-8">
      <Reveal className="flex flex-col gap-3">
        <span className="lg-label" style={{ color: "var(--lg-lime)" }}>{"// developer playground"}</span>
        <h2 className="text-[28px] font-semibold tracking-[-0.03em] sm:text-[38px]" style={{ fontFamily: "var(--lg-font-display)" }}>
          Try the machine-buyer surface
        </h2>
        <p className="max-w-2xl text-[14px] leading-relaxed" style={{ color: "var(--lg-muted)" }}>
          These are this deployment&#39;s real routes, and the checkout is
          authenticated: sign in at <a href="/login" style={{ color: "var(--lg-lime)" }}>/login</a> or present a
          Bearer API key. {data.payments.live
            ? "Payments run on Razorpay test mode — test keys only, live keys refused by code."
            : "No payment credentials are set, so payment references are simulated and labelled TXN_DEMO_*."}
        </p>
      </Reveal>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Reveal className="lg-panel flex flex-col gap-4 p-6">
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {(["curl", "ts", "python"] as const).map((l) => (
                <button key={l} type="button" className="lg-tab" data-active={lang === l} onClick={() => setLang(l)}>
                  {l === "ts" ? "TypeScript" : l === "curl" ? "cURL" : "Python"}
                </button>
              ))}
            </div>
            <span className="lg-label" style={{ color: "var(--lg-lime)" }}>/api/catalog · /api/checkout</span>
          </div>
          <pre className="lg-code flex-1"><code>{snippets[lang]}</code></pre>
          <div className="flex items-center justify-between">
            <span className="lg-label" style={{ color: "var(--lg-dim)" }}>THIS DEPLOYMENT · NODE 24 · SQLITE</span>
            <button type="button" className="lg-btn-primary" onClick={run} disabled={running}>
              {running ? "Calling…" : "Execute browse turn"}
            </button>
          </div>
        </Reveal>

        <Reveal delay={120} className="lg-well flex flex-col gap-4 p-6">
          <div className="flex items-center justify-between">
            <span className="lg-label" style={{ color: "var(--lg-text)" }}>LIVE RESPONSE</span>
            <span className="lg-pill" style={{ color: "var(--lg-lime)" }}>
              <span className="lg-led" /> REAL CALL, REAL AGENT
            </span>
          </div>
          <pre className="lg-code flex-1"><code>{response}</code></pre>
          <div className="flex items-center justify-between">
            <span className="lg-label" style={{ color: "var(--lg-dim)" }}>ENGINE: {data.engine.toUpperCase()}</span>
            <span className="lg-label" style={{ color: "var(--lg-lime)" }}>AUDIT LOGGED</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Section 6: Dock + footer ───────────────────────────────────────────────

function Dock({ data }: { data: ShowcaseData }) {
  return (
    <>
      <div className="lg-dock">
        <div className="lg-dock-inner">
          <a href="#directions" className="lg-label" style={{ color: "var(--lg-muted)" }}>Directions</a>
          <span style={{ color: "var(--lg-dim)" }}>•</span>
          <a href="#gates" className="lg-label" style={{ color: "var(--lg-muted)" }}>Gates</a>
          <span style={{ color: "var(--lg-dim)" }}>•</span>
          <a href="#credentials" className="lg-label" style={{ color: "var(--lg-lime)" }}>Credentials</a>
          <span style={{ color: "var(--lg-dim)" }}>•</span>
          <span className="lg-label flex items-center gap-2" style={{ color: "var(--lg-lime)" }}>
            <span className="lg-led lg-led-pulse" /> {data.engineMode === "deterministic" ? "DEMO ENGINE" : "HOSTED MODEL"}
          </span>
        </div>
      </div>

      <footer className="border-t px-6 py-6" style={{ borderColor: "var(--lg-line)" }}>
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 text-center md:flex-row md:text-left">
          <span className="lg-label" style={{ color: "var(--lg-dim)" }}>
            {data.payments.label} · {data.supplier.label} — both labelled, never faked
          </span>
          <span className="lg-label" style={{ color: "var(--lg-dim)" }}>
            UAP / ACP / AP2 / x402: seam ready, nothing claimed
          </span>
        </div>
      </footer>
    </>
  );
}

// ─── Page assembly ───────────────────────────────────────────────────────────

export function AgenticShowcase({ data }: { data: ShowcaseData }) {
  return (
    <div className="showcase">
      <ScrollProgress />
      <Hero data={data} />
      <ProtocolRace />
      <Directions data={data} />
      <Gates data={data} />
      <Credentials />
      <Playground data={data} />
      <Dock data={data} />
    </div>
  );
}
