import { expect, test } from "@playwright/test";

test("every backend process saw outbound network blocked", async ({ request }) => {
  const h = await (await request.get("/api/health")).json();
  expect(h).toMatchObject({ db: "ok", smtp: "ok", queue: "ok" });
  // Only meaningful under the offline wrapper; scripts/e2e.sh sets EGRESS_CANARY=1.
  expect(h.egress).toMatchObject({ web: "blocked", worker: "blocked" });
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
