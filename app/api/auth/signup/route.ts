/**
 * POST /api/auth/signup — create an account.
 *
 * Rate-limited tightly (5/min/IP): account creation is the one endpoint whose
 * abuse is unbounded, since each successful call mints a principal. The
 * password bar is enforced here, and the scrypt hash never leaves lib/auth.
 */
import { z } from "zod";
import { body, clientIp, fail, handle, ok, overRateLimit, ready, tooManyRequests } from "@/lib/api";
import { createAccount, passwordProblems } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Payload = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().max(120),
  password: z.string().min(8).max(200),
  role: z.enum(["operator", "buyer"]).default("operator"),
});

export async function POST(request: Request) {
  try {
    if (overRateLimit("api:signup", clientIp(request))) return tooManyRequests("api:signup");
    ready();

    const parsed = await body(request, Payload);
    if (parsed.error) return parsed.error;
    const { name, email, password, role } = parsed.data;

    const problems = passwordProblems(password);
    if (problems.length > 0) {
      return fail(`Password needs ${problems.join(", ")}.`, 400);
    }

    try {
      const account = createAccount({ email, name, password, role });
      return ok(
        {
          account: {
            id: account.id,
            email: account.email,
            name: account.name,
            role: account.role,
          },
        },
        { status: 201 },
      );
    } catch (error) {
      // The unique constraint on email is the only expected failure.
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("UNIQUE")) {
        return fail("An account with that email already exists.", 409);
      }
      throw error;
    }
  } catch (error) {
    return handle(error, "auth/signup");
  }
}
