import { apiCtx, apiError, notFoundResponse } from "@/server/api";
import { handoverData, handoverVersionsFor, loadCase } from "@/server/services/cases";
import { renderHandover } from "@/lib/handover";

export async function GET(req: Request, { params }: { params: Promise<{ org: string; caseId: string }> }) {
  const { org, caseId } = await params;
  const ctx = await apiCtx(org);
  if (!ctx) return notFoundResponse();
  try {
    const c = await loadCase(ctx, caseId);
    const v = new URL(req.url).searchParams.get("v") ?? "draft";
    let markdown: string, suffix: string;
    if (v === "draft") {
      markdown = renderHandover(await handoverData(ctx, caseId), null);
      suffix = "draft";
    } else {
      const found = (await handoverVersionsFor(ctx, caseId)).find((x) => String(x.version) === v);
      if (!found) return notFoundResponse();
      markdown = found.markdown;
      suffix = `v${found.version}`;
    }
    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${c.ref}-handover-${suffix}.md"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
