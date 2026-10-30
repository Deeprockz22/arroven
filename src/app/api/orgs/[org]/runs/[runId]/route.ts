import { apiCtx, apiError, notFoundResponse } from "@/server/api";
import { getRun } from "@/server/ai/runs";

export async function GET(_: Request, { params }: { params: Promise<{ org: string; runId: string }> }) {
  const { org, runId } = await params;
  const ctx = await apiCtx(org);
  if (!ctx) return notFoundResponse();
  try {
    const r = await getRun(ctx, runId);
    return Response.json({ status: r.status, kind: r.kind, produced: r.produced, dropped: r.dropped, error: r.error }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
