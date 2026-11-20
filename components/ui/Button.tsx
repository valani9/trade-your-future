import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "letgo" | "ghost" | "quiet" | "danger";
type Size = "lg" | "md" | "sm";

const variants: Record<Variant, string> = {
  primary: "bg-coral text-[#0A0B0D] hover:brightness-105 active:brightness-95",
  letgo: "bg-slate text-[#0A0B0D] hover:brightness-105 active:brightness-95",
  ghost: "bg-white/[0.06] text-ink hover:bg-white/[0.1] active:bg-white/[0.08]",
  quiet: "bg-transparent text-muted hover:text-ink hover:bg-white/[0.05]",
  danger: "bg-transparent text-coral border border-coral/40 hover:bg-coral/10",
};

const sizes: Record<Size, string> = {
  lg: "h-14 px-6 text-[16px] font-semibold",
  md: "h-12 px-5 text-[15px] font-medium",
  sm: "h-9 px-4 text-[13px] font-medium",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  full?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "lg", loading, full, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-btn transition-all duration-200 ease-out select-none",
        "disabled:opacity-40 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        full && "w-full",
        className,
      )}
      {...props}
    >
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : null}
      {children}
    </button>
  );
});
