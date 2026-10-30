import Link from "next/link";

export function Wordmark({ href = "/", light = false }: { href?: string; light?: boolean }) {
  return (
    <Link href={href} className={`inline-flex items-baseline gap-2 no-underline ${light ? "text-white" : "text-accent"}`}>
      <span className="font-display text-[17px] font-bold tracking-[0.16em] uppercase">Arroven</span>
    </Link>
  );
}
