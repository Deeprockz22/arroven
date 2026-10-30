import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { orgsForUser } from "@/server/services/accounts";
import { requireUser } from "@/server/session";
import { AuthShell } from "@/components/auth-shell";
import { signOutAction } from "@/app/actions";

export default async function AppHome() {
  const user = await requireUser();
  const orgs = await orgsForUser(await getDb(), user.id);
  if (orgs.length) redirect(`/app/${orgs[0].slug}/cases`);
  return (
    <AuthShell title="No workspace yet" subtitle={`Signed in as ${user.email}.`}>
      <p className="caption">You are not a member of any organization. Ask an administrator for an invite link.</p>
      <form action={signOutAction}><button className="btn">Sign out</button></form>
    </AuthShell>
  );
}
