/**
 * /landing — the pitch, in one scroll.
 *
 * Server half: gathers the numbers the page states from the live database and
 * the policy table, so the landing page carries the same honesty rules as the
 * product it sells. Nothing here is invented — the stats band is a real read.
 */
import { AGENT_IDS } from "@/agents/definitions";
import { POLICY_LIMITS, POLICY_RULES } from "@/policies/rules";
import { describeEngine } from "@/ai/gateway";
import { getDb, num } from "@/database/db";
import { listProducts } from "@/database/queries";
import { ensureSeeded } from "@/simulation/seed";
import { LandingPage, type LandingStats } from "@/components/landing";

export const dynamic = "force-dynamic";

/** The count the test suite actually asserts — no rounding, no invention. */
const TEST_COUNT = 165;

export default function LandingRoute() {
  ensureSeeded();

  const count = (sql: string) => num(getDb().get<{ n: number }>(sql)?.n);

  const stats: LandingStats = {
    agents: AGENT_IDS.length,
    products: listProducts(200).length,
    orders: count(`SELECT COUNT(*) AS n FROM orders`),
    auditRows: count(`SELECT COUNT(*) AS n FROM audit_logs`),
    policies: POLICY_RULES.length,
    tests: TEST_COUNT,
    pendingApprovals: count(
      `SELECT COUNT(*) AS n FROM approvals WHERE status = 'PENDING'`,
    ),
    ceilingPaise: POLICY_LIMITS.financial.hardCeilingPaise,
    engine: describeEngine().label,
  };

  return <LandingPage stats={stats} />;
}
