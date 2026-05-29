import { expect, test } from "@playwright/test";
import { magicLinkSignIn, staffLogin, waitForMail } from "./helpers";

test("resident reports a gas smell: EMERGENCY by rule, staff assign it, resident gets a status email", async ({ page, browser }) => {
  const email = "resident@bayview.test";
  await magicLinkSignIn(page, email, "/bayview/portal", async (p) => {
    await p.fill("#email", email);
    await p.getByRole("button", { name: /sign-in link/ }).click();
  });
  await page.goto("/bayview/portal/tickets/new");
  const title = `Kitchen ${Date.now()}`;
  await page.fill("#title", title);
  await page.fill("#description", "I smell gas near the stove.");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Marked as an emergency")).toBeVisible();
  await expect(page.getByText(/Leave the unit now/)).toBeVisible();

  const staff = await (await browser.newContext()).newPage();
  await staffLogin(staff, "maintenance@bayview.test");
  await staff.goto("/dashboard/bayview/maintenance");
  await staff.getByRole("link", { name: new RegExp(title) }).click();
  await expect(staff.getByText("Safety rule matched: gas")).toBeVisible();
  await staff.selectOption("#assignee", { label: "Ray Mendes (maintenance)" });
  await staff.getByRole("button", { name: "Assign" }).click();
  await expect(staff.getByText("Assigned.")).toBeVisible();
  await waitForMail(email, new RegExp(`Update: ${title}`));
});
