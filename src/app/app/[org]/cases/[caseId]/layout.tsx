import { requireOrg } from "@/server/session";
import { caseHypotheses, caseProposals, caseQuestions, caseStatements, handoverVersionsFor, loadCase } from "@/server/services/cases";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { logDate } from "@/lib/labels";
import { CaseTabs } from "@/components/case-tabs";

export default async function CaseLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string; caseId: string }> }) {
  const { org: slug, caseId } = await params;
  const { ctx } = await requireOrg(slug);
  const c = await loadCase(ctx, caseId);
  const [stmts, qs, versions, hs, props, resp] = await Promise.all([
    caseStatements(ctx, caseId), caseQuestions(ctx, caseId), handoverVersionsFor(ctx, caseId), caseHypotheses(ctx, caseId), caseProposals(ctx, caseId),
    c.responsibleEngineerId ? ctx.db.select({ name: users.name }).from(users).where(eq(users.id, c.responsibleEngineerId)) : Promise.resolve([]),
  ]);
  const unreviewed = stmts.filter((s) => s.status === "unreviewed").length;
  const recheck = stmts.filter((s) => s.needsReassessment && s.status !== "rejected").length;
  const reassess = hs.filter((h) => h.needsReassessment).length;
  const pendingProposals = props.filter((p) => p.status === "proposed").length;
  const openQ = qs.filter((q) => q.status === "open").length;
  const latest = versions[0]?.version ?? 0;
  const base = `/app/${slug}/cases/${caseId}`;

  const meta = [c.aircraft, c.system, c.evidenceCutoff ? `Cutoff ${logDate(c.evidenceCutoff)}` : null, resp[0]?.name ? `Responsible: ${resp[0].name}` : null].filter(Boolean).join("  ·  ");
  const status = c.status === "closed" ? { cls: "pill-inc", text: "Closed" }
    : latest === 0 ? { cls: "pill-amber", text: "Not approved" }
    : c.changedSinceApproval ? { cls: "pill-amber", text: `v${latest} · changed since` }
    : { cls: "pill-good", text: `v${latest} approved` };

  return (
    <div className="grid gap-4">
      <header className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a href={base} className="mono text-[12.5px] font-medium text-accent">{c.ref}</a>
          <span className={`pill ${status.cls}`}>{status.text}</span>
          {c.isDemo && <span className="pill pill-inc">Demo</span>}
        </div>
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.01em]">{c.title}</h1>
        <p className="caption">{meta}</p>
        <details className="group max-w-[90ch]">
          <summary className="cursor-pointer list-none text-[13.5px] text-muted">
            <span className="font-medium text-ink">Question:</span> <span className="group-open:hidden">{c.question.length > 110 ? `${c.question.slice(0, c.question.lastIndexOf(" ", 110))}…` : c.question}</span>
          </summary>
          <p className="mt-1 text-[14px]">{c.question}</p>
        </details>
      </header>
      {(recheck > 0 || reassess > 0) && (
        <p className="msg-warn">
          A record or the question changed.{recheck > 0 && <> {recheck} statement{recheck > 1 ? "s need" : " needs"} a re-check.</>}
          {reassess > 0 && <> {reassess} explanation{reassess > 1 ? "s need" : " needs"} reassessment.</>}
        </p>
      )}
      <CaseTabs base={base} tabs={[
        { href: "", label: "Overview" },
        { href: "/sources", label: "Sources" },
        { href: "/chronology", label: "Chronology", badge: unreviewed + recheck || undefined },
        { href: "/explanations", label: "Explanations", badge: reassess || undefined },
        { href: "/compare", label: "Compare", badge: pendingProposals || undefined },
        { href: "/review", label: "Review", badge: openQ || undefined },
        { href: "/activity", label: "Activity" },
      ]} />
      <div>{children}</div>
    </div>
  );
}
