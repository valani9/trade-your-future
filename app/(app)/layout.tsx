import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { TabBar } from "@/components/ui/TabBar";
import { OfflineBanner } from "@/components/app/OfflineBanner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  return (
    <div className="relative mx-auto min-h-dvh w-full max-w-app pb-[calc(env(safe-area-inset-bottom)+72px)]">
      <aside
        aria-hidden
        className="pointer-events-none fixed left-[max(32px,calc(50%-540px))] top-1/2 hidden w-[280px] -translate-y-1/2 select-none lg:block"
      >
        <p className="text-[11px] uppercase tracking-[0.16em] text-coral">Trade Your Future</p>
        <h1 className="mt-3 text-[40px] font-semibold leading-[1.02] tracking-tightest">
          Buy and trade
          <br />
          your future.
        </h1>
        <p className="mt-4 max-w-[260px] text-[14px] leading-relaxed text-muted">
          Swipe right to claim it. Left to let it go. Money held until handover.
        </p>
        <div className="mt-6 h-px w-16 bg-line" />
      </aside>
      <OfflineBanner />
      {children}
      <TabBar />
    </div>
  );
}
