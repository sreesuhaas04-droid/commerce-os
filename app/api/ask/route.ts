import { z } from "zod";
import { planForQuestion, runPlan } from "@/orchestration/orchestrator";
import { body, clientIp, handle, ok, overRateLimit, ready, tooManyRequests } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Payload = z.object({ question: z.string().min(3).max(400) });

/** Free-text entry point: "why did sales drop yesterday?" */
export async function POST(request: Request) {
  try {
    if (overRateLimit("api:ask", clientIp(request))) return tooManyRequests("api:ask");
    ready();
    const parsed = await body(request, Payload);
    if (parsed.error) return parsed.error;

    const request_ = await planForQuestion(parsed.data.question);
    const run = await runPlan(request_);

    return ok({
      question: parsed.data.question,
      template: { id: request_.template.id, title: request_.template.title },
      plan: {
        id: run.plan.id,
        title: run.plan.title,
        status: run.plan.status,
        correlationId: run.plan.correlationId,
        // Whether the model or the fallback template produced this task graph,
        // and the model's reasoning (or why its plan was rejected).
        plannedBy: run.plan.plannedBy,
        planNote: run.plan.planNote,
        tasks: run.tasks,
      },
      results: run.results,
      failed: run.failed,
    });
  } catch (error) {
    return handle(error, "ask");
  }
}
