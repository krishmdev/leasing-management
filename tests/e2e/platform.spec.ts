import { expect, test } from "@playwright/test";

test("egress canary in the web server and the worker matches the sandbox", async ({ request }) => {
  const h = await (await request.get("/api/health")).json();
  expect(h).toMatchObject({ db: "ok", smtp: "ok", queue: "ok" });
  // Both processes run the canary at startup (EGRESS_CANARY=1). Under the offline wrapper every
  // connection must fail; run without it and the same canary must connect, which is what shows
  // the check isn't vacuous.
  const expected = process.env.E2E_OFFLINE === "1" ? "blocked" : "OPEN";
  expect(h.egress).toEqual({ web: expected, worker: expected });
});

test("the two agencies render with their own themes", async ({ page }) => {
  const brand = async (slug: string) => {
    await page.goto(`/${slug}`);
    return page.locator(`[data-agency="${slug}"]`).evaluate((el) => getComputedStyle(el).getPropertyValue("--brand").trim());
  };
  const b = await brand("bayview");
  const p = await brand("peninsula");
  expect(b).not.toBe(p);
  await page.goto("/peninsula");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Peninsula rentals");
  await page.goto("/bayview");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Oakland apartments");
});
