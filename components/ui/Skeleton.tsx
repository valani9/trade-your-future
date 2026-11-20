import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-shimmer rounded-xl bg-white/[0.06]", className)} />;
}

export function CardSkeleton() {
  return (
    <div className="rounded-card bg-surface border border-line p-3">
      <Skeleton className="aspect-[3/4] w-full rounded-[18px]" />
      <div className="space-y-2 pt-4 px-1 pb-1">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}
