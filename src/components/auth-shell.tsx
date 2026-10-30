import { Wordmark } from "./brand";

const POINTS = [
  "Every drafted statement cites the exact line it came from",
  "Your engineers check, correct and decide",
  "Records stay with ARROVEN's own models",
];

/** Sign-in, sign-up and invite pages: a blue brand panel beside a plain form. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen bg-surface lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="hidden flex-col justify-between bg-bar p-10 text-white lg:flex">
        <Wordmark light />
        <div className="grid max-w-md gap-6">
          <p className="text-[30px] font-semibold leading-tight tracking-[-0.01em]">See what the work on a recurring defect actually established.</p>
          <ul className="grid gap-3 text-[15px] text-white/85">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-3">
                <span aria-hidden className="mt-[9px] h-1.5 w-1.5 flex-none rounded-full bg-white" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[12.5px] text-white/60">Supports investigation reasoning. Not a root-cause, maintenance or airworthiness decision.</p>
      </aside>

      <div className="grid content-start">
        <div className="bg-bar px-5 py-3.5 lg:hidden"><Wordmark light /></div>
        <main className="grid min-h-[calc(100vh-52px)] place-items-center px-5 py-10 lg:min-h-screen">
          <div className="grid w-full max-w-[380px] gap-6">
            <div className="grid gap-1.5">
              <h1 className="text-[26px] font-semibold tracking-[-0.01em]">{title}</h1>
              {subtitle && <p className="text-[14.5px] text-muted">{subtitle}</p>}
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
