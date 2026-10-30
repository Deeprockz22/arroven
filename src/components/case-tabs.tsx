"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function CaseTabs({ base, tabs }: { base: string; tabs: { href: string; label: string; badge?: number }[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Case sections">
      {tabs.map((t) => {
        const href = `${base}${t.href}`;
        const active = t.href === "" ? path === base : path.startsWith(href);
        return (
          <Link
            key={t.href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-2 text-[14px] font-medium ${active ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}
          >
            {t.label}
            {t.badge ? <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-accent-ink" aria-label={`${t.badge} need attention`}>{t.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
