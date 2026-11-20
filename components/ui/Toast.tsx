"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "error" | "money";
type ToastItem = { key: number; text: string; tone: Tone };

const ToastContext = createContext<{ show: (text: string, tone?: Tone) => void }>({ show: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const show = useCallback((text: string, tone: Tone = "neutral") => {
    const key = ++seq.current;
    setItems((prev) => [...prev.slice(-2), { key, text, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((i) => i.key !== key)), 3000);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-[60] flex flex-col items-center gap-2 px-4"
      >
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.key}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "pointer-events-none max-w-app rounded-btn border px-4 py-3 text-[13px] font-medium shadow-soft backdrop-blur",
                item.tone === "error" && "border-coral/40 bg-[#2A1512]/95 text-ink",
                item.tone === "money" && "border-mint/30 bg-[#10251D]/95 text-ink",
                item.tone === "neutral" && "border-line bg-raised/95 text-ink",
              )}
            >
              {item.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
