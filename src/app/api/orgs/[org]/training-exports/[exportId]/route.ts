import { apiCtx, apiError, notFoundResponse } from "@/server/api";
import { readTrainingExport } from "@/server/training/export";
import { audit } from "@/server/audit";

/** Download a training dataset (JSON Lines). Admins and owners only; every download is logged. */
export async function GET(_: Request, { params }: { params: Promise<{ org: string; exportId: string }> }) {
  const { org, exportId } = await params;
  const ctx = await apiCtx(org);
  if (!ctx) return notFoundResponse();
  try {
    const { row, bytes } = await readTrainingExport(ctx, exportId);
    await audit(ctx.db, ctx, "training.export_downloaded", "training_export", row.id, null, { sha256: row.sha256 });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Content-Disposition": `attachment; filename="arroven-training-${row.createdAt.toISOString().slice(0, 10)}-${row.id.slice(0, 8)}.jsonl"`,
        "X-Content-SHA256": row.sha256,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
