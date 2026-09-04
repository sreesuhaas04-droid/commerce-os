"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import {
  Activity, BadgeCheck, BarChart3, Boxes, Brain, Cpu, Gauge, KeyRound,
  LineChart, Megaphone, Orbit, Package, PackageCheck, ScrollText, Settings,
  ShieldCheck, Sparkles, Truck, Users, Wallet,
} from "lucide-react";
import { cn } from "@/lib/cn";

const NAV: { group: string; items: { href: string; label: string; icon: typeof Gauge }[] }[] = [
  {
    group: "Operations",
    items: [
      { href: "/", label: "Command Center", icon: Gauge },
      { href: "/showcase", label: "Agentic Showcase", icon: Orbit },
      { href: "/agents", label: "Agents", icon: Cpu },
      { href: "/goals", label: "Goals", icon: BadgeCheck },
      { href: "/approvals", label: "Approvals", icon: ShieldCheck },
    ],
  },
  {
    group: "Intelligence",
    items: [
      { href: "/inventory", label: "Inventory", icon: Boxes },
      { href: "/pricing", label: "Pricing", icon: LineChart },
      { href: "/marketing", label: "Marketing", icon: Megaphone },
      { href: "/customers", label: "Customers", icon: Users },
      { href: "/procurement", label: "Procurement", icon: Truck },
      { href: "/fulfillment", label: "Fulfilment", icon: PackageCheck },
      { href: "/finance", label: "Finance", icon: Wallet },
      { href: "/products", label: "Catalogue", icon: Package },
    ],
  },
  {
    group: "System",
    items: [
      { href: "/login", label: "Account & Keys", icon: KeyRound },
      { href: "/simulation", label: "Simulator", icon: Sparkles },
      { href: "/events", label: "Event Stream", icon: Activity },
      { href: "/audit", label: "Audit Log", icon: ScrollText },
      { href: "/memory", label: "Agent Memory", icon: Brain },
      { href: "/observability", label: "Observability", icon: BarChart3 },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-4">
      {/* A masthead, not a logo lockup: the name set in the serif, a rule
          beneath it, and the standing line underneath in the apparatus face. */}
      <Link href="/" className="block px-2 pt-1">
        <span className="block text-[17px] font-semibold tracking-[-0.02em] leading-none">Commerce OS</span>
        <span className="mt-2 block rule-strong" />
        <span className="caps mt-1.5 block">Multi-agent operations</span>
      </Link>

      {NAV.map((section) => (
        <div key={section.group}>
          <div
            className="caps px-2 pb-1.5 pt-1"
            style={{ color: "var(--ink-3)" }}
          >
            {section.group}
          </div>
          <ul className="space-y-0.5">
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12px] transition-colors",
                      active ? "font-medium" : "hover:bg-[var(--panel-2)]",
                    )}
                    style={
                      active
                        ? { background: "var(--panel-2)", color: "var(--accent)" }
                        : { color: "var(--ink-2)" }
                    }
                  >
                    <Icon size={14} strokeWidth={1.9} />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function EngineBadge({
  engine,
}: {
  engine: { label: string; mode: "deterministic" | "hosted"; detail: string };
}) {
  const deterministic = engine.mode === "deterministic";
  return (
    <div
      className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
      title={engine.detail}
      style={{ borderColor: deterministic ? "var(--warn)" : "var(--good)" }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: deterministic ? "var(--warn)" : "var(--good)" }}
      />
      <span className="text-[10px] uppercase tracking-[0.07em]" style={{ color: "var(--ink-2)" }}>
        {deterministic ? "Demo mode" : "Hosted model"}
      </span>
      <span className="num hidden text-[10px] sm:inline" style={{ color: "var(--ink-3)" }}>
        {engine.label}
      </span>
    </div>
  );
}

/**
 * The theme lives on `<html data-theme>`, set before first paint by the inline
 * script in the layout. This component reads that attribute rather than holding
 * its own copy, so there is no state to synchronise and no flash on load.
 */
function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

const readTheme = (): "dark" | "light" =>
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";

/**
 * The active edition, read from the DOM rather than held in state.
 *
 * Three components need it — the shell, the ambient ground and the hero — and
 * each keeping its own copy meant three subscriptions that could disagree, and
 * a setState inside an effect in every one of them. `useSyncExternalStore` is
 * the API for exactly this: an external value with a subscription and an
 * server-side default.
 */
export const useTheme = (): "dark" | "light" =>
  useSyncExternalStore(subscribeTheme, readTheme, () => "light" as const);

export function ThemeToggle() {
  const theme = useTheme();

  return (
    <button
      type="button"
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        localStorage.setItem("commerce-os-theme", next);
      }}
      className="rounded-md border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.07em] transition-colors hover:bg-[var(--panel-2)]"
      style={{ color: "var(--ink-2)" }}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? "Dark" : "Light"}
    </button>
  );
}

export function ResetButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/simulation/reset", { method: "POST" });
          window.location.reload();
        } catch {
          setBusy(false);
        }
      }}
      className="rounded-md border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.07em] transition-colors hover:bg-[var(--panel-2)] disabled:opacity-50"
      style={{ color: "var(--ink-2)" }}
    >
      {busy ? "Resetting…" : "Reset demo"}
    </button>
  );
}
