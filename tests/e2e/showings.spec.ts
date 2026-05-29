import { expect, test } from "@playwright/test";
import { attachmentText, uniq, waitForMail } from "./helpers";

test("interest, then a booked showing whose email carries an .ics invite", async ({ page }) => {
  await page.goto("/bayview/listings");
  await page.locator("a[href^='/bayview/listings/']").first().click();
  const listing = page.url();

  const ioi = uniq("ioi");
  await page.getByRole("link", { name: "I'm interested" }).click();
  await page.fill("#name", "Casey Rivera");
  await page.fill("#email", ioi);
  await page.fill("#desiredMoveIn", new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("All set")).toBeVisible();
  await waitForMail(ioi, /We got your note/);

  const who = uniq("tour");
  await page.goto(`${listing}/schedule`);
  await page.getByRole("radio").first().click();
  await page.fill("#name", "Casey Rivera");
  await page.fill("#email", who);
  await page.getByRole("button", { name: "Book showing" }).click();
  await expect(page.getByText("All set")).toBeVisible();
  const mail = await waitForMail(who, /Showing confirmed/);
  const ics = mail.Attachments.find((a) => a.FileName.endsWith(".ics"));
  expect(ics).toBeTruthy();
  const body = await attachmentText(mail.ID, ics!.PartID);
  expect(body).toContain("BEGIN:VCALENDAR");
  expect(body).toMatch(/UID:showing-.*@leasing\.test/);
  expect(body).toContain("SEQUENCE:0");
});
