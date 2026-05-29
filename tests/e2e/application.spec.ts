import { expect, test, type Page } from "@playwright/test";
import { linkIn, magicLinkSignIn, poll, staffLogin, uniq, waitForMail } from "./helpers";

const SSN = "078-05-1120";

async function applyAndScreen(page: Page, agency: "bayview" | "peninsula", email: string, landlord: string, persona: string) {
  await page.goto(`/${agency}/listings`);
  const href = await page.locator(`a[href^='/${agency}/listings/']`).first().getAttribute("href");
  const unitSlug = href!.split("/").pop()!;
  await magicLinkSignIn(page, email, `/${agency}/apply?unit=${unitSlug}`, async (p) => {
    await p.fill("#name", "Jamie Ortiz");
    await p.fill("#email", email);
    await p.getByRole("button", { name: "Email me a link" }).click();
  });
  await expect(page).toHaveURL(new RegExp(`/${agency}/apply`));
  await page.getByRole("button", { name: /Start or continue/ }).click();

  await page.fill("#legalName", "Jamie Ortiz");
  await page.fill("#phone", "510-555-0177");
  await page.fill("#desiredMoveIn", new Date(Date.now() + 25 * 86_400_000).toISOString().slice(0, 10));
  await page.fill("#totalOccupants", "2");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await page.fill("[id='r0.address']", "88 Webster St, Oakland");
  await page.fill("[id='r0.startDate']", "2022-03-01");
  await page.fill("[id='r0.endDate']", "2026-08-31");
  await page.fill("[id='r0.monthlyRent']", "2400");
  await page.fill("[id='r0.landlordName']", "Pat Morgan");
  await page.fill("[id='r0.landlordEmail']", landlord);
  await page.getByRole("button", { name: "Save and continue" }).click();

  await page.fill("#monthlyIncome", "15000");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.locator("#fcra").check();
  await page.getByRole("button", { name: "Save and continue" }).click();
  for (const id of ["esign", "privacy", "accurate"]) await page.locator(`#${id}`).check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page).toHaveURL(/\/status$/);

  // Landlord reference, from the email the landlord gets.
  const refMail = await waitForMail(landlord, /Rental reference/);
  const ref = await page.context().newPage();
  await ref.goto(linkIn(refMail.Text, /https?:\/\/\S+\/r\/[A-Za-z0-9_-]+/));
  await ref.getByText("Always", { exact: true }).click();
  await ref.selectOption("#propertyCondition", "5");
  await ref.getByText("Yes", { exact: true }).click();
  await ref.fill("#freeText", "Always paid on time and kept the place spotless.");
  await ref.locator("#attestation").check();
  await ref.getByRole("button", { name: "Send reference" }).click();
  await expect(ref.getByText(/Thank you/)).toBeVisible();
  await ref.close();

  // Screening on the provider's page. The SSN typed here must never leave the browser.
  const invite = await waitForMail(email, /Complete your screening/);
  const hosted = linkIn(invite.Text, /https?:\/\/\S+\/mock-provider\/\S+/);
  const bodies: string[] = [];
  page.on("request", (r) => bodies.push(`${r.url()} ${r.postData() ?? ""}`));
  await page.goto(hosted);
  await page.getByTestId("ssn").fill(SSN);
  await page.getByTestId("dob").fill("1990-04-12");
  await page.getByLabel(new RegExp(persona, "i")).check();
  await page.getByLabel(/I authorize MockCRA/).check();
  await page.getByRole("button", { name: "Verify and authorize" }).click();
  await expect(page.getByText(/leasing office/)).toBeVisible();
  expect(bodies.length).toBeGreaterThan(0);
  for (const b of bodies) {
    expect(b).not.toContain(SSN);
    expect(b).not.toContain(SSN.replaceAll("-", ""));
    expect(b).not.toContain("1990-04-12");
  }
}

test("assisted agency: apply, reference, screening, staff approval, lease signed", async ({ page, browser }) => {
  const email = uniq("applicant");
  const landlord = uniq("landlord");
  await applyAndScreen(page, "bayview", email, landlord, "Excellent credit");

  const staff = await (await browser.newContext()).newPage();
  await staffLogin(staff, "owner@bayview.test");
  await poll(async () => {
    await staff.goto("/dashboard/bayview/approvals");
    return (await staff.getByRole("link", { name: "Jamie O." }).count()) > 0;
  }, 90_000, 1500);
  await staff.getByRole("link", { name: "Jamie O." }).first().click();
  await expect(staff.getByText("Agent timeline")).toBeVisible();
  await expect(staff.getByText("policy.apply")).toBeVisible();
  await staff.getByRole("button", { name: "Record decision" }).click();
  await expect(staff.getByText(/approve by staff/)).toBeVisible();

  const leaseMail = await waitForMail(email, /Your lease for/);
  await page.goto(linkIn(leaseMail.Text, /https?:\/\/\S+\/lease\/[A-Za-z0-9_-]+/));
  await poll(async () => {
    await page.reload();
    return (await page.locator("iframe[title='Lease document']").count()) > 0;
  }, 60_000, 1500);
  await page.fill("#typedName", "Jamie Ortiz");
  await page.locator("#consent").check();
  await page.getByRole("button", { name: "Sign lease" }).click();
  await expect(page.getByTestId("signed")).toBeVisible();
  await waitForMail(email, /Lease signed/);

  // The reviewed lease PDF downloads with the signing link, and the signed copy shows up on the status page.
  const src = await page.locator("iframe[title='Lease document']").getAttribute("src");
  const pdf = await page.request.get(src!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const statusPath = new URL(page.url()).pathname.replace(/\/lease\/.*/, "");
  await poll(async () => {
    await page.goto(`${statusPath}/apply`.replace("/apply", ""));
    return true;
  });
});

test("autonomous agency approves a strong applicant with no one touching it", async ({ page }) => {
  const email = uniq("auto");
  await applyAndScreen(page, "peninsula", email, uniq("ll"), "Excellent credit");
  await waitForMail(email, /Approved/, 90_000);
  await waitForMail(email, /Your lease for/, 90_000);
});
