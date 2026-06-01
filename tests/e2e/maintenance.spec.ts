import sharp from "sharp";
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

test("resident submits repair ticket with an image attachment, staff assigns on maintenance board, status email delivery, and visual status update in portal", async ({ page, browser }) => {
  const photoBuffer = await sharp({
    create: {
      width: 200,
      height: 200,
      channels: 4,
      background: { r: 59, g: 130, b: 246, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const email = "resident@bayview.test";
  await magicLinkSignIn(page, email, "/bayview/portal", async (p) => {
    await p.fill("#email", email);
    await p.getByRole("button", { name: /sign-in link/ }).click();
  });

  await page.goto("/bayview/portal/tickets/new");
  const title = `Leaking pipe ${Date.now()}`;
  await page.fill("#title", title);
  await page.fill("#description", "Dripping water under the bathroom sink.");
  if ((await page.locator("#category").count()) > 0) {
    await page.fill("#category", "PLUMBING");
  }
  await page.setInputFiles("#photos", {
    name: "pipe-leak.png",
    mimeType: "image/png",
    buffer: photoBuffer,
  });
  await page.check("#permissionToEnter");
  await page.getByRole("button", { name: "Send request" }).click();

  // Navigate to resident ticket view
  await expect(page.getByText("Request received")).toBeVisible();
  await page.getByRole("button", { name: "View request" }).click();
  await expect(page).toHaveURL(/\/bayview\/portal\/tickets\//);

  // Verifies resident ticket detail page shows photo thumbnail, permission to enter, and visual status stepper with Received
  await expect(page.locator("img[alt*='Photo']").first()).toBeVisible();
  await expect(page.getByText(/Permission to enter/i)).toBeVisible();
  const residentStatusStepper = page.getByTestId("ticket-status");
  await expect(residentStatusStepper).toBeVisible();
  await expect(residentStatusStepper).toContainText(/Received/i);

  // Separate browser context for staff operations
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await staffLogin(staff, "maintenance@bayview.test");
  await staff.goto("/dashboard/bayview/maintenance");
  await staff.getByRole("link", { name: new RegExp(title) }).click();

  // Verifies photo thumbnail is visible on staff desk
  await expect(staff.locator("img[alt*='Photo']").first()).toBeVisible();

  // Assigns ticket to Ray Mendes
  await staff.selectOption("#assignee", { label: "Ray Mendes (maintenance)" });
  await staff.getByRole("button", { name: "Assign" }).click();
  await expect(staff.getByText("Assigned.")).toBeVisible();

  // Asserts status update email received in Mailpit with subject containing "Update:" and body containing "assigned to a technician"
  const mail = await waitForMail(email, new RegExp(`Update: ${title}`));
  expect(mail.Subject).toContain("Update:");
  expect(mail.Text).toContain("assigned to a technician");

  // Reloads resident ticket page and asserts visual status stepper has advanced to Assigned (ASSIGNED)
  await page.reload();
  await expect(page.getByTestId("ticket-status")).toBeVisible();
  await expect(page.getByTestId("ticket-status")).toContainText(/Assigned/i);

  await staffContext.close();
});
