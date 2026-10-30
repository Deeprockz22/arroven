import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { PLANS } from "@/server/plans";

const STEPS = [
  ["Open a case", "One unresolved defect, one question."],
  ["Import records", "Read-only copies. Originals are never changed."],
  ["Models draft", "Every statement cites an exact line."],
  ["Engineers decide", "Check, correct, and test each explanation."],
  ["Approve a version", "A frozen handover. Changes start a new one."],
];

const SPLIT = [
  ["Drafts short statements, each citing a page, row or line", "Whether each statement is faithful to its source"],
  ["Orders reports, work and tests by date", "Whether identities, order and conditions are right"],
  ["Finds evidence and flags conflicts and gaps", "What each finding means for an explanation, and why"],
  ["Assembles the handover from checked records", "The judgement, the open questions and the approval"],
];

const TRUST = [
  ["Originals stay original", "Stored once, read-only, and checked against a fingerprint on every read."],
  ["Every claim is checkable", "A statement citing a line that doesn't exist is dropped and counted, so errors are visible."],
  ["Your data stays with us", "ARROVEN's own models only. No third-party AI service ever sees your records."],
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-surface">
      <header className="bg-bar">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <Wordmark light />
          <nav className="flex items-center gap-2">
            <Link href="/login" className="rounded-lg px-3 py-1.5 text-[14px] font-medium text-white/90 hover:text-white">Sign in</Link>
            <Link href="/signup" className="rounded-lg bg-white px-3.5 py-1.5 text-[14px] font-semibold text-accent hover:bg-accent-soft">Start a pilot</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="border-b border-line bg-gradient-to-b from-accent-soft to-surface">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 lg:grid-cols-[1.1fr_1fr]">
            <div className="grid gap-5">
              <p className="text-[13.5px] font-medium text-accent">For recurring and intermittent aircraft defects</p>
              <h1 className="text-[clamp(32px,4.6vw,48px)] font-semibold leading-[1.08] tracking-[-0.02em]">The fault keeps coming back. See what the work so far actually established.</h1>
              <p className="max-w-[54ch] text-[17px] text-muted">
                ARROVEN reads the records behind an unresolved defect, drafts a timeline in which every line cites its source, and lets your
                engineers test each explanation against the evidence.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/signup" className="btn btn-primary px-5 py-2.5 text-[15px]">Start a 60-day pilot</Link>
                <Link href="/signup" className="btn px-5 py-2.5 text-[15px]">Try the demo case</Link>
              </div>
            </div>

            <div className="card grid gap-3 p-5 shadow-[0_12px_40px_-12px_rgba(26,95,216,0.25)]" aria-label="Example of a drafted statement">
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="mono text-muted">29 MAR 2026</span>
                <span className="text-muted">Reported</span>
                <span className="loc">S6:2</span>
                <span className="pill pill-amber">Unreviewed</span>
              </div>
              <p className="text-[15px]">BLEED 1 FAULT at FL380, about 1 h after top of climb; recovered after about 4 min without crew action.</p>
              <p className="text-[13px] text-amber">Uncertain: the message log shows two events this flight; the tech log describes one.</p>
              <div className="flex gap-2">
                <span className="btn btn-sm btn-primary">Accept</span>
                <span className="btn btn-sm">Reject</span>
                <span className="btn btn-sm">Correct wording</span>
              </div>
              <div className="rounded-lg bg-sunk p-3">
                <p className="caption mb-1">Original · Technical log page TLB-4475</p>
                <p className="mono rounded bg-[var(--hl)] px-2 py-1 text-[12px]">S6:2 Entry 4 (crew): BLEED 1 FAULT, FL380, approx 1 h after TOC. Bleed 1 recovered after about 4 min without crew action.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-6 px-5 py-14">
          <h2 className="text-[24px] font-semibold">How a case runs</h2>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="card grid content-start gap-1.5 p-4">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-accent-ink">{i + 1}</span>
                <h3 className="text-[15px] font-semibold">{t}</h3>
                <p className="caption">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="bg-sunk">
          <div className="mx-auto grid max-w-6xl gap-6 px-5 py-14">
            <div className="grid gap-1">
              <h2 className="text-[24px] font-semibold">The models draft. The engineer decides.</h2>
              <p className="text-muted">ARROVEN never declares a root cause, directs maintenance or makes an airworthiness decision.</p>
            </div>
            <div className="card overflow-hidden">
              <div className="grid grid-cols-2 border-b border-line bg-accent-soft text-[13.5px] font-semibold">
                <span className="px-5 py-3 text-accent">ARROVEN&apos;s models</span>
                <span className="px-5 py-3">Your engineer</span>
              </div>
              {SPLIT.map(([a, b]) => (
                <div key={a} className="grid grid-cols-2 border-b border-line text-[14px] last:border-0">
                  <span className="px-5 py-3 text-muted">{a}</span>
                  <span className="px-5 py-3">{b}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-5 px-5 py-14 md:grid-cols-3">
          {TRUST.map(([t, d]) => (
            <div key={t} className="grid content-start gap-2 border-t-2 border-accent pt-4">
              <h3 className="text-[16px] font-semibold">{t}</h3>
              <p className="text-[14px] text-muted">{d}</p>
            </div>
          ))}
        </section>

        <section className="border-t border-line" id="pricing">
          <div className="mx-auto grid max-w-6xl gap-6 px-5 py-14">
            <h2 className="text-[24px] font-semibold">Plans</h2>
            <div className="grid gap-4 md:grid-cols-3">
              {Object.entries(PLANS).map(([key, p]) => (
                <div key={key} className={`card grid content-start gap-3 p-5 ${key === "trial" ? "border-accent" : ""}`}>
                  <div className="grid gap-0.5">
                    <h3 className="text-[18px] font-semibold">{p.label}</h3>
                    <p className="caption">{p.price}</p>
                  </div>
                  <ul className="grid gap-1.5 text-[14px]">
                    <li>{p.openCases === null ? "Unlimited open cases" : `${p.openCases} open cases`}</li>
                    <li>{p.aiRunsPerMonth === null ? "Unmetered model runs" : `${p.aiRunsPerMonth.toLocaleString()} model runs a month`}</li>
                    <li>{p.seats === null ? "Unlimited members" : `Up to ${p.seats} members`}</li>
                    {key === "enterprise" && <li>Runs inside your own environment</li>}
                  </ul>
                  {key === "trial" && <Link href="/signup" className="btn btn-primary w-fit">Start a pilot</Link>}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-sunk">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-5 py-6 caption">
          <span>Supports investigation reasoning. Not a root-cause, maintenance or airworthiness decision.</span>
          <span>© {new Date().getFullYear()} ARROVEN</span>
        </div>
      </footer>
    </div>
  );
}
