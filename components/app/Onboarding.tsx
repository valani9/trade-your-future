"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/Button";

const slides = [
  {
    kicker: "Empirical",
    title: "Buy and trade your future.",
    body: "Tickets, tables, nights away. Swipe right to claim it, left to let it go.",
    image: "/demo/wine-bar.webp",
  },
  {
    kicker: "Your plans, live",
    title: "Two plans, one night?",
    body: "We spot the clash and help you sell the one you'll skip.",
    image: "/demo/jazz-club.webp",
  },
  {
    kicker: "Money, handled",
    title: "Pay once. Held until it's yours.",
    body: "Your money sits safe until handover. Sellers get paid when you're covered.",
    image: "/demo/theater-stage.webp",
  },
];

export function Onboarding({
  googleEnabled,
  demoAction,
  googleAction,
}: {
  googleEnabled: boolean;
  demoAction: () => Promise<void>;
  googleAction: () => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const last = step === slides.length - 1;

  return (
    <main className="mx-auto flex min-h-dvh max-w-app flex-col px-5 pb-[max(env(safe-area-inset-bottom),24px)] pt-6">
      <div className="flex items-center justify-between">
        <span className="text-[22px] font-extrabold tracking-tighter text-ink">Empirical<span className="text-coral">.</span></span>
        {!last ? (
          <button onClick={() => setStep(slides.length - 1)} className="-mr-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill px-4 text-[14px] font-semibold text-muted hover:text-ink">
            Skip
          </button>
        ) : null}
      </div>

      <div className="relative mt-4 flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0"
          >
            <div className="relative h-full overflow-hidden rounded-card bg-[#1A1A19] text-white shadow-soft">
              <img
                src={slides[step].image}
                alt=""
                decoding="async"
                fetchPriority={step === 0 ? "high" : "auto"}
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-6">
                <p className="inline-flex rounded-pill bg-white px-3 py-1 text-[12px] font-bold text-ink">{slides[step].kicker}</p>
                <h1 className="mt-3 text-[36px] font-extrabold leading-[1.02] tracking-tightest text-white text-balance">
                  {slides[step].title}
                </h1>
                <p className="mt-3 max-w-[300px] text-[15px] leading-relaxed text-white/80">{slides[step].body}</p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-5 flex justify-center gap-1.5" aria-hidden>
        {slides.map((_, i) => (
          <span key={i} className={`h-1 rounded-pill transition-all ${i === step ? "w-6 bg-coral" : "w-1.5 bg-ink/20"}`} />
        ))}
      </div>

      <div className="mt-5 space-y-2.5">
        {last ? (
          <>
            <form action={demoAction}>
              <Button full type="submit">
                Try the demo
              </Button>
            </form>
            {googleEnabled ? (
              <form action={googleAction}>
                <Button full variant="ghost" type="submit">
                  Continue with Google
                </Button>
              </form>
            ) : null}
          </>
        ) : (
          <Button full onClick={() => setStep(step + 1)}>
            Next
          </Button>
        )}
      </div>
    </main>
  );
}
