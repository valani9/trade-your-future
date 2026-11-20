import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card bg-surface border border-line", className)} {...props} />;
}

export function Row({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-4 py-3.5 border-b border-line last:border-b-0",
        className,
      )}
      {...props}
    />
  );
}
