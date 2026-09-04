import { getAgentImpl } from "@/agents";
import { isAgentId } from "@/agents/definitions";
import { newCorrelationId } from "@/lib/ids";
import { clientIp, fail, handle, ok, overRateLimit, ready, tooManyRequests } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Runs a single agent on demand, outside any plan. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (overRateLimit("api:agents/run", clientIp(request))) {
      return tooManyRequests("api:agents/run");
    }
    ready();
    const { id } = await context.params;
    if (!isAgentId(id)) return fail(`No such agent: ${id}`, 404);

    const result = await getAgentImpl(id).run({
      correlationId: newCorrelationId(),
      taskId: null,
      priorResults: [],
    });
    return ok({ result });
  } catch (error) {
    return handle(error, "agents/[id]/run");
  }
}
