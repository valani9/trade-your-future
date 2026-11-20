"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart, ListChecks, Wallet, Tag } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/buy", label: "Buy", icon: Heart },
  { href: "/sell", label: "Sell", icon: Tag },
  { href: "/orders", label: "Orders", icon: ListChecks },
  { href: "/wallet", label: "Wallet", icon: Wallet },
];

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-app items-stretch justify-around px-2 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5">
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-[68px] flex-col items-center gap-1 rounded-btn px-3 py-1.5 text-[12px] font-semibold transition-colors",
                active ? "text-coral" : "text-faint hover:text-muted",
              )}
            >
              <Icon size={21} strokeWidth={active ? 2.2 : 1.8} fill={active && tab.href === "/buy" ? "currentColor" : "none"} />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
