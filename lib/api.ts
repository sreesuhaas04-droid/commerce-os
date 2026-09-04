/**
 * Route-handler helpers.
 *
 * Every API route runs on Node (the database is a Node builtin) and is
 * dynamic — this is an operations console, nothing here is prerenderable.
 */
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { ensureSeeded } from "@/simulation/seed";
import { startWorker } from "@/events/queue";
// Registers the fulfillment job handler as a side effect of import. Without it
// a queued fulfilment would have nothing to run it and would dead-letter.
import "@/integrations/fulfillment-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** First request on a fresh clone seeds the demo, so `npm run dev` is enough. */
export function ready(): void {
  ensureSeeded();
  // Idempotent and pinned to globalThis, so this is a no-op after the first call.
  startWorker();
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Parses and validates a JSON body, returning a typed value or a 400 response. */
export async function body<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ data: T; error: null } | { data: null; error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { data: null, error: fail("Request body must be valid JSON") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      data: null,
      error: fail("Invalid request", 400, { issues: issues(parsed.error) }),
    };
  }
  return { data: parsed.data, error: null };
}

export function issues(error: ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
}

/** Turns a thrown error into a response the UI can render usefully. */
export function handle(error: unknown, context: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[api] ${context}:`, error);
  return fail(message, 500, { context });
}

export const searchParam = (request: Request, key: string): string | undefined =>
  new URL(request.url).searchParams.get(key) ?? undefined;

export function intParam(request: Request, key: string, fallback: number): number {
  const raw = searchParam(request, key);
  const value = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(value) ? value : fallback;
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

/**
 * A fixed-window limiter for the routes that run plans or hit a model.
 *
 * This console is one shared password wide open, and the routes that run the
 * full eight-agent pipeline on a request are the ones a stuck client — a
 * retry loop, a held-open demo tab, or a script with the password — can turn
 * into a self-inflicted denial of service. The limits are per IP per window,
 * which is the granularity a demo gate can honestly support: there are no
 * accounts, so there is nothing finer to key on.
 *
 * In-process, like everything else here (single instance is a deployment
 * requirement). One map of windows pinned to globalThis so dev recompiles do
 * not fork the counters.
 */
const RATE_LIMITS: Record<string, { limit: number; windowMs: number }> = {
  // A full plan run is 5–8 agent runs; 20 within a minute is a loop, not a user.
  "api:ask": { limit: 20, windowMs: 60_000 },
  "api:agents/run": { limit: 30, windowMs: 60_000 },
  "api:events/simulate": { limit: 20, windowMs: 60_000 },
  // Credential endpoints: a tight budget, because brute force is the threat
  // model here, not load. 10 login attempts a minute is generous for a human
  // and hopeless for a script.
  "api:login": { limit: 10, windowMs: 60_000 },
  "api:signup": { limit: 5, windowMs: 60_000 },
};

const rateRef = globalThis as unknown as {
  __commerceRateWindows?: Map<string, { start: number; count: number }>;
};

/** True when the request is over its limit; the caller returns 429. */
export function overRateLimit(bucket: keyof typeof RATE_LIMITS, ip: string): boolean {
  const rule = RATE_LIMITS[bucket];
  rateRef.__commerceRateWindows ??= new Map();
  const windows = rateRef.__commerceRateWindows;
  const key = `${bucket}:${ip}`;
  const now = Date.now();

  let window = windows.get(key);
  if (!window || now - window.start >= rule.windowMs) {
    window = { start: now, count: 0 };
    windows.set(key, window);
  }
  window.count += 1;

  if (windows.size > 5000) {
    for (const [key, w] of windows) if (now - w.start >= rule.windowMs) windows.delete(key);
  }

  return window.count > rule.limit;
}

/** Best-effort client IP — behind a proxy the platform's header wins. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "local";
}

/** A 429 with a Retry-After the caller can use directly. */
export function tooManyRequests(bucket: string): NextResponse {
  const retryAfter = Math.ceil((RATE_LIMITS[bucket]?.windowMs ?? 60_000) / 1000);
  return NextResponse.json(
    { error: `Too many requests to ${bucket}. Retry in ${retryAfter}s.` },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );
}
