"use client";

import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-30 border-b border-line bg-[#2A1512] px-4 py-2 text-center text-[12px] text-ink/80"
    >
      You&apos;re offline. We&apos;ll pick up when you&apos;re back.
    </div>
  );
}
