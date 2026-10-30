import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { requireOrg } from "@/server/session";
import { getDb } from "@/server/db";
import { orgsForUser } from "@/server/services/accounts";
import { ROLE_LABELS } from "@/server/permissions";
import { signOutAction } from "@/app/actions";
import { getProvider } from "@/server/ai/provider";

export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { user, org, role } = await requireOrg(slug);
  const orgs = await orgsForUser(await getDb(), user.id);
  const mock = getProvider().name === "mock";
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-bar text-white shadow-sm">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
          <Wordmark href={`/app/${slug}/cases`} light />
          <nav className="flex items-center gap-4 text-[13.5px] font-medium text-white/85">
            <Link href={`/app/${slug}/cases`} className="hover:text-white">Cases</Link>
            <Link href={`/app/${slug}/settings`} className="hover:text-white">Settings</Link>
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-[13px]">
            {mock && <span className="pill bg-white/15 text-white" title="No MODEL_SERVICE_URL is set, so drafting uses an offline mock.">Mock models</span>}
            {orgs.length > 1 ? (
              <details className="relative">
                <summary className="cursor-pointer list-none font-semibold">{org.name} ▾</summary>
                <div className="card absolute right-0 z-30 mt-2 grid min-w-56 gap-1 p-2 text-ink">
                  {orgs.map((o) => <Link key={o.id} href={`/app/${o.slug}/cases`} className="rounded px-2 py-1 hover:bg-sunk">{o.name}</Link>)}
                </div>
              </details>
            ) : <span className="font-semibold">{org.name}</span>}
            <span className="text-[12.5px] text-white/75">{user.name} · {ROLE_LABELS[role]}</span>
            <form action={signOutAction}><button className="rounded-md border border-white/30 px-2.5 py-1 text-[12.5px] font-medium text-white hover:bg-white/10">Sign out</button></form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1320px] px-5 pb-16 pt-6">{children}</div>
    </div>
  );
}
