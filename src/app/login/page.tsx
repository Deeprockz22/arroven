import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, Submit } from "@/components/forms";
import { signInAction } from "@/app/actions";
import { currentUser } from "@/server/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await currentUser()) redirect(next ?? "/app");
  return (
    <AuthShell title="Sign in" subtitle="This ARROVEN workspace is private.">
      <ActionForm action={signInAction} className="grid gap-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <label className="field"><span>Work email</span><input className="input" type="email" name="email" autoComplete="email" required /></label>
        <label className="field"><span>Password</span><input className="input" type="password" name="password" autoComplete="current-password" required /></label>
        <Submit className="btn btn-primary w-full justify-center py-2.5 text-[14.5px]" pendingText="Signing in…">Sign in</Submit>
      </ActionForm>
      <p className="border-t border-line pt-5 text-[14px] text-muted">Access is by invitation only.</p>
    </AuthShell>
  );
}
