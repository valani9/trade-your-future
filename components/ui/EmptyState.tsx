import type { ReactNode } from "react";

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center animate-rise">
      <h2 className="text-[26px] font-semibold tracking-tighter leading-[1.15] text-balance">{title}</h2>
      {body ? <p className="max-w-[280px] text-[14px] leading-relaxed text-muted">{body}</p> : null}
      {action ? <div className="pt-3">{action}</div> : null}
    </div>
  );
}
