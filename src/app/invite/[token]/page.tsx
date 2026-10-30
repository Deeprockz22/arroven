import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, Submit } from "@/components/forms";
import { acceptInviteAction } from "@/app/actions";
import { getDb } from "@/server/db";
import { inviteDetails } from "@/server/services/accounts";
import { currentUser } from "@/server/session";

export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await inviteDetails(await getDb(), token);
  const user = await currentUser();
  if (!inv) return <AuthShell title="Invite not valid"><p className="caption">This invite link has expired or was already used. Ask the person who invited you for a new one.</p></AuthShell>;
  if (!user) redirect(`/signup?invite=${token}`);
  return (
    <AuthShell title={`Join ${inv.orgName}`} subtitle={`Invited as ${inv.invite.role} (${inv.invite.email}).`}>
      <ActionForm action={acceptInviteAction} className="grid gap-3">
        <input type="hidden" name="token" value={token} />
        <p className="caption">Signed in as {user.email}.</p>
        <Submit className="btn btn-primary w-full justify-center py-2.5 text-[14.5px]" pendingText="Joining…">Accept invite</Submit>
      </ActionForm>
      <p className="caption"><Link href="/app" className="text-accent">Not now</Link></p>
    </AuthShell>
  );
}
