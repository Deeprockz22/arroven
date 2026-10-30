import { redirect } from "next/navigation";

export default async function OrgHome({ params }: { params: Promise<{ org: string }> }) {
  redirect(`/app/${(await params).org}/cases`);
}
