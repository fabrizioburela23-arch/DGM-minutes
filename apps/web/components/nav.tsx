"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; badge?: number };

export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 pb-2 text-sm">
      {items.map((item) => {
        const active = path === item.href || path.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 font-medium ${active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-200"}`}
          >
            {item.label}
            {item.badge ? (
              <span className={`rounded-full px-1.5 text-xs ${active ? "bg-white text-slate-900" : "bg-amber-500 text-white"}`}>{item.badge}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
