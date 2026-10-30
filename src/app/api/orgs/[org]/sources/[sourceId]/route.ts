import { apiCtx, apiError, notFoundResponse } from "@/server/api";
import { getSource } from "@/server/services/cases";
import { readOriginal } from "@/server/sources/storage";

/** Serve the original record exactly as imported. Its hash is checked on every read. */
export async function GET(_: Request, { params }: { params: Promise<{ org: string; sourceId: string }> }) {
  const { org, sourceId } = await params;
  const ctx = await apiCtx(org);
  if (!ctx) return notFoundResponse();
  try {
    const s = await getSource(ctx, sourceId);
    if (!s.storageKey) return notFoundResponse();
    const buf = await readOriginal(s.storageKey);
    const name = (s.fileName ?? `${s.code}.bin`).replace(/[^\w.\- ]/g, "_");
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": s.mimeType ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${s.code} - ${name}"`,
        "X-Content-SHA256": s.sha256 ?? "",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
