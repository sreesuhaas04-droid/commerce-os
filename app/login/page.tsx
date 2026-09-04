/**
 * /login — the standalone account console.
 *
 * The full console (sign in, create account, issue and revoke API keys) lives
 * in components/auth-console.tsx so the agentic showcase can embed the same
 * component as one of its acts. This page is the focused, linkable form.
 */
import { AuthConsole } from "@/components/auth-console";

export default function LoginPage() {
  return <AuthConsole />;
}
