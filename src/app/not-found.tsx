import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";

export default function NotFound() {
  return (
    <AuthShell title="Not found" subtitle="This page does not exist, or you do not have access to it.">
      <Link href="/app" className="btn btn-primary w-fit">Go to your cases</Link>
    </AuthShell>
  );
}
