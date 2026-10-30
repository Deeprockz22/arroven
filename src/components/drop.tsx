/** A button that opens a small panel below it. Plain <details>, so it works without JavaScript. */
export function Drop({ label, primary, small, align = "right", children }: {
  label: string; primary?: boolean; small?: boolean; align?: "left" | "right"; children: React.ReactNode;
}) {
  return (
    <details className="group relative">
      <summary className={`btn list-none ${primary ? "btn-primary" : ""} ${small ? "btn-sm" : ""}`}>{label}</summary>
      <div className={`card absolute z-20 mt-2 w-[min(440px,90vw)] p-4 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}>{children}</div>
    </details>
  );
}
