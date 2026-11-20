import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  if (!/\/buy/.test(page.url())) {
    const skip = page.getByRole("button", { name: /^skip$/i });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    const demo = page.getByRole("button", { name: /try the demo/i });
    await demo.waitFor({ state: "visible", timeout: 15_000 });
    await demo.click();
  }
  await page.waitForURL(/\/buy/, { timeout: 45_000 });
  await page.getByRole("button", { name: "Claim it", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await page.evaluate(async () => {
    for (let i = 0; i < 2; i++) await fetch("/api/wallet/fund", { method: "POST" });
  });
});

test("deck renders, swipes both ways, and undoes", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  const firstTitle = await page.locator("h2").first().innerText();
  await page.getByRole("button", { name: "Let it go", exact: true }).click();
  await page.waitForTimeout(800);
  const afterLeft = await page.locator("h2").first().innerText();
  expect(afterLeft).not.toBe(firstTitle);

  await page.getByRole("button", { name: /undo/i }).click();
  await page.waitForTimeout(900);
  await expect(page.locator("h2").first()).toHaveText(firstTitle);

  await page.getByRole("button", { name: "Claim it", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Pay \$/ })).toBeVisible();

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});

test("claim, pay and land on the order timeline", async ({ page }) => {
  await page.getByRole("button", { name: "Claim it", exact: true }).click();
  await page.getByRole("button", { name: /^Pay \$/ }).click();
  await page.waitForURL(/\/orders\//, { timeout: 30_000 });
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /got it/i }).click({ timeout: 30_000 });
  await expect(page.getByText("Complete", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Held safely until you confirm|Secured on Solana|Paid to/)).toBeVisible({ timeout: 30_000 });
});

test("feed can be walked to the end", async ({ page }) => {
  await page.goto("/api/feed");
  const first = await page.evaluate(async () => (await fetch("/api/feed")).json());
  expect(first.items.length).toBeGreaterThan(0);
  let cursor = first.nextCursor;
  let total = first.items.length;
  let guard = 0;
  while (cursor && guard < 30) {
    const next = await page.evaluate(async (c) => (await fetch(`/api/feed?cursor=${encodeURIComponent(c)}`)).json(), cursor);
    total += next.items.length;
    cursor = next.nextCursor;
    guard++;
  }
  expect(total).toBeGreaterThanOrEqual(60);
});
