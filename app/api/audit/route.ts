import { listAudit } from "@/database/queries";
import { handle, intParam, ok, ready, searchParam } from "@/lib/api";
import type { RiskLevel } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RISKS = new Set<RiskLevel>(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const STATUSES = new Set(["COMPLETED", "DENIED", "PENDING_APPROVAL", "FAILED"]);

/** A filter with a known value, or undefined — unknown values are ignored, not passed through. */
const oneOf = (raw: string | undefined, allowed: Set<string>): string | undefined =>
  raw && allowed.has(raw) ? raw : undefined;

export async function GET(request: Request) {
  try {
    ready();
    const entries = listAudit({
      agentId: searchParam(request, "agent"),
      risk: oneOf(searchParam(request, "risk"), RISKS),
      status: oneOf(searchParam(request, "status"), STATUSES),
      limit: intParam(request, "limit", 150),
    });
    return ok({
      entries,
      counts: entries.reduce<Record<string, number>>((acc, entry) => {
        acc[entry.executionStatus] = (acc[entry.executionStatus] ?? 0) + 1;
        return acc;
      }, {}),
    });
  } catch (error) {
    return handle(error, "audit");
  }
}
