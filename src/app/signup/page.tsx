import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, Submit } from "@/components/forms";
import { signUpAction } from "@/app/actions";
import { getDb } from "@/server/db";
import { inviteDetails, openSignupAllowed } from "@/server/services/accounts";

export const metadata: Metadata = { title: "Start a pilot" };

export default async function SignUp({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  const db = await getDb();
  const inv = invite ? await inviteDetails(db, invite) : null;
  if (!inv && !(await openSignupAllowed(db))) {
    return (
      <AuthShell title="Sign-up is by invitation" subtitle="This ARROVEN workspace is private. Ask its administrator for an invite link.">
        {invite && <p className="msg-error">This invite link has expired or was already used. Ask for a new one.</p>}
        <p className="border-t border-line pt-5 text-[14px] text-muted">Already have an account? <Link href="/login" className="font-medium text-accent hover:underline">Sign in</Link></p>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title={inv ? `Join ${inv.orgName}` : "Start a pilot"}
      subtitle={inv ? `You were invited as ${inv.invite.role}. Create your account with ${inv.invite.email}.` : "Free for 60 days. You can try a fictional demo case straight away."}
    >
      {invite && !inv && <p className="msg-error">This invite link has expired or was already used. Ask for a new one.</p>}
      <ActionForm action={signUpAction} className="grid gap-4">
        {inv && <input type="hidden" name="invite" value={invite} />}
        <label className="field"><span>Your name</span><input className="input" name="name" autoComplete="name" required /></label>
        <label className="field"><span>Work email</span><input className="input" type="email" name="email" autoComplete="email" defaultValue={inv?.invite.email} readOnly={!!inv} required /></label>
        <label className="field"><span>Password</span><input className="input" type="password" name="password" autoComplete="new-password" minLength={10} placeholder="At least 10 characters" required /></label>
        {!inv && <label className="field"><span>Organization</span><input className="input" name="orgName" placeholder="Your airline or MRO" required /></label>}
        <Submit className="btn btn-primary w-full justify-center py-2.5 text-[14.5px]" pendingText="Creating…">{inv ? "Create account and join" : "Create workspace"}</Submit>
      </ActionForm>
      <p className="border-t border-line pt-5 text-[14px] text-muted">Already have an account? <Link href={invite ? `/login?next=/invite/${invite}` : "/login"} className="font-medium text-accent hover:underline">Sign in</Link></p>
    </AuthShell>
  );
}
