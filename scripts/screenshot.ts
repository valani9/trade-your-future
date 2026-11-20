import { chromium, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const phase = process.env.PHASE ?? "P1";
const round = process.env.ROUND ?? "1";
const outDir = path.join(
  process.env.HOME ?? ".",
  ".capy/work/tyf/shots",
  phase,
  `round-${round}`,
);

const sizes = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];

async function login(page: Page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const demo = page.getByRole("button", { name: /try the demo/i });
  if (await demo.count()) {
    for (let i = 0; i < 2; i++) {
      const skip = page.getByRole("button", { name: /^skip$/i });
      if (await skip.count()) await skip.click();
      const next = page.getByRole("button", { name: /^next$/i });
      if (await next.count()) await next.click();
    }
    await demo.click();
    await page.waitForURL(/\/buy/, { timeout: 30000 });
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const errors: string[] = [];

  for (const size of sizes) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 2,
      isMobile: size.name === "mobile",
      hasTouch: size.name === "mobile",
    });
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[${size.name}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => errors.push(`[${size.name}] pageerror: ${err.message}`));

    await login(page);
    const routes: Array<[string, string]> = [
      ["/buy", "buy"],
      ["/sell", "sell"],
      ["/orders", "orders"],
      ["/wallet", "wallet"],
      ["/settings", "settings"],
      ["/styleguide", "styleguide"],
    ];
    const extraRoutes: Array<[string, string]> = [];
    const orderId = await page.evaluate(async () => {
      const list = await (await fetch("/api/orders?role=buyer")).json();
      return list.items?.[0]?.id ?? null;
    });
    if (orderId) extraRoutes.push([`/orders/${orderId}`, "order-detail"]);
    routes.push(...extraRoutes);
    for (const [route, name] of routes) {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(outDir, `${name}-${size.name}.png`), fullPage: false });
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      if (scrollW > size.width + 1) errors.push(`[${size.name}] horizontal scroll on ${route}: ${scrollW}px`);
    }
    await context.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(outDir, "console-errors.txt"), errors.join("\n") || "none");
  console.log(`shots -> ${outDir}`);
  console.log(errors.length ? errors.slice(0, 20).join("\n") : "no console errors");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
