"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startRunAction } from "@/app/actions";

interface RunStatus { status: "queued" | "running" | "succeeded" | "failed"; produced: number; dropped: number; error: string | null; kind: string }

/** Starts an AI drafting run, follows it until it finishes, then refreshes the page's data. */
export function AiRunButton({
  org, caseId, kind, hypothesisId, label, activeRunId, disabled, providerLabel,
}: {
  org: string; caseId: string; kind: "chronology" | "evidence" | "analysis"; hypothesisId?: string; label: string;
  activeRunId?: string | null; disabled?: boolean; providerLabel: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(startRunAction, undefined);
  const [runId, setRunId] = useState<string | null>(activeRunId ?? null);
  const [result, setResult] = useState<RunStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (state?.data?.runId) { setRunId(state.data.runId); setResult(null); setElapsed(0); }
  }, [state]);

  useEffect(() => {
    if (!runId) return;
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop) return;
      setElapsed(Math.round((Date.now() - started) / 1000));
      try {
        const r = await fetch(`/api/orgs/${org}/runs/${runId}`, { cache: "no-store" });
        if (r.ok) {
          const s = (await r.json()) as RunStatus;
          if (s.status === "succeeded" || s.status === "failed") {
            setResult(s); setRunId(null); router.refresh(); return;
          }
        }
      } catch { /* keep polling */ }
      setTimeout(tick, 2000);
    };
    tick();
    return () => { stop = true; };
  }, [runId, org, router]);

  const busy = pending || !!runId;
  return (
    <div className="grid gap-2">
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="org" value={org} />
        <input type="hidden" name="caseId" value={caseId} />
        <input type="hidden" name="kind" value={kind} />
        {hypothesisId && <input type="hidden" name="hypothesisId" value={hypothesisId} />}
        <button className="btn btn-primary" disabled={busy || disabled}>{busy ? "Drafting…" : label}</button>
        <span className="caption">{busy ? `${providerLabel} is working${elapsed ? ` · ${elapsed}s` : ""}. You can keep working; the page updates when it finishes.` : providerLabel}</span>
      </form>
      {state?.error && <p className="msg-error" role="alert">{state.error}</p>}
      {result?.status === "failed" && <p className="msg-error" role="alert">{result.error}</p>}
      {result?.status === "succeeded" && (
        <p className="msg-info" role="status">
          {kind === "chronology"
            ? `Drafted ${result.produced} new statement${result.produced === 1 ? "" : "s"} for checking.`
            : kind === "analysis"
              ? `Prepared ${result.produced} comparison${result.produced === 1 ? "" : "s"} and proposal${result.produced === 1 ? "" : "s"} for review.`
              : `Suggested ${result.produced} relevant statement${result.produced === 1 ? "" : "s"}.`}
          {result.dropped ? ` ${result.dropped} item${result.dropped === 1 ? "" : "s"} cited a line or statement that does not exist and ${result.dropped === 1 ? "was" : "were"} dropped.` : " Every citation resolved to a real record line."}
        </p>
      )}
    </div>
  );
}
