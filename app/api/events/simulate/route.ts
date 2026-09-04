import { z } from "zod";
import { SCENARIOS, triggerScenario } from "@/simulation/scenarios";
import {
  body,
  clientIp,
  handle,
  ok,
  overRateLimit,
  ready,
  tooManyRequests,
} from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Payload = z.object({
  scenario: z.string(),
  /** false fires the event without running the plan it would select. */
  autoRun: z.boolean().default(true),
});

export async function GET() {
  return ok({ scenarios: SCENARIOS.map(({ id, label, description, expect }) => ({ id, label, description, expect })) });
}

export async function POST(request: Request) {
  try {
    if (overRateLimit("api:events/simulate", clientIp(request))) {
      return tooManyRequests("api:events/simulate");
    }
    ready();
    const parsed = await body(request, Payload);
    if (parsed.error) return parsed.error;

    const run = await triggerScenario(parsed.data.scenario, { autoRun: parsed.data.autoRun });
    return ok({
      ...run,
      plan: run.plan
        ? {
            id: run.plan.plan.id,
            title: run.plan.plan.title,
            status: run.plan.plan.status,
            tasks: run.plan.tasks,
            results: run.plan.results,
            failed: run.plan.failed,
          }
        : null,
    });
  } catch (error) {
    return handle(error, "events/simulate");
  }
}
