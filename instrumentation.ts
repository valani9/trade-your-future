export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.CRON_SELF_TICK === "off") return;
  const interval = Number(process.env.CRON_INTERVAL_MS ?? 5 * 60_000);
  const { appDb } = await import("@/lib/boot");
  const { cronTick } = await import("@/lib/services/orders");
  const { expireStaleListings } = await import("@/lib/services/plans");
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const db = await appDb();
      await expireStaleListings(db);
      await cronTick(db);
    } catch (error) {
      console.error("tick failed", error);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 10_000).unref?.();
  setInterval(tick, interval).unref?.();
}
