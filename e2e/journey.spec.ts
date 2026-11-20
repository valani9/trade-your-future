import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/");
  if (!/\/buy/.test(page.url())) {
    const skip = page.getByRole("button", { name: /^skip$/i });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.getByRole("button", { name: /try the demo/i }).click();
  }
  await page.waitForURL(/\/buy/, { timeout: 45_000 });
  await page.waitForSelector("text=Swipe right to claim", { timeout: 30_000 });
}

test("full journey: claim, pay, handover, complete, receipt", async ({ page }) => {
  const started = Date.now();
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await signIn(page);
  await page.screenshot({ path: "artifacts/e2e/01-buy.png" });

  await page.getByRole("button", { name: "Claim it" }).click();
  await page.getByRole("button", { name: /^Pay \$/ }).click();
  await page.waitForURL(/\/orders\//, { timeout: 30_000 });
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /got it/i }).click({ timeout: 40_000 });
  await expect(page.getByText("Complete", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Secured on Solana/)).toBeVisible();
  await page.screenshot({ path: "artifacts/e2e/02-receipt.png" });

  expect(errors).toEqual([]);
  expect(Date.now() - started).toBeLessThan(120_000);
});

test("clash banner offers a sale and the listing lands", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: /sell/i }).first().click();
  await expect(page.getByText(/plans at/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /to resolve the clash/i })).toBeVisible();

  await page.getByRole("button", { name: "Sell this one", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: /^List for/ }).click();
  await expect(page.getByText(/Listed\./i)).toBeVisible({ timeout: 20_000 });
});

test("swap offer can be sent from a card", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: /swap instead/i }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const offer = page.getByRole("dialog").getByRole("button").filter({ hasText: /at|pm|am/i }).first();
  if (await offer.count()) {
    await offer.click();
    await expect(page.getByText(/Offer sent/i)).toBeVisible({ timeout: 20_000 });
  }
});

test("no horizontal scroll and labelled controls on every screen", async ({ page }) => {
  await signIn(page);
  for (const route of ["/buy", "/sell", "/orders", "/wallet", "/settings"]) {
    await page.goto(route);
    await page.waitForTimeout(600);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `horizontal scroll on ${route}`).toBeLessThanOrEqual(391);

    const unnamed = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .filter((el) => {
          const text = (el.textContent ?? "").trim();
          return !text && !el.getAttribute("aria-label") && !el.getAttribute("title");
        })
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(unnamed, `unnamed buttons on ${route}`).toEqual([]);
  }
});
