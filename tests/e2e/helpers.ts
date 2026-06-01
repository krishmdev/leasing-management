import { expect, type Page } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:8041";

export const uniq = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;

interface Msg { ID: string; Subject: string; Attachments: number }

/** Wait for an email to `to` whose subject matches, and return its text and attachments. */
export async function waitForMail(to: string, subject: RegExp, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`);
    const { messages } = (await r.json()) as { messages: Msg[] };
    const m = messages.find((x) => subject.test(x.Subject));
    if (m) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string; HTML: string; Attachments: { FileName: string; ContentType: string; PartID: string }[] };
      return { ...m, ...full };
    }
    if (Date.now() > until) throw new Error(`no email to ${to} matching ${subject}; got: ${messages.map((x) => x.Subject).join(" | ")}`);
    await new Promise((res) => setTimeout(res, 500));
  }
}

export async function attachmentText(messageId: string, partId: string) {
  return (await fetch(`${MAILPIT}/api/v1/message/${messageId}/part/${partId}`)).text();
}

export function linkIn(text: string, pattern: RegExp) {
  const m = text.match(pattern);
  if (!m) throw new Error(`no link matching ${pattern} in:\n${text.slice(0, 800)}`);
  return m[0];
}

export async function staffLogin(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", "demo-password-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard\//);
  // The landing has to render for this role, not just redirect somewhere.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/something went wrong|don't have access|no access/i)).toHaveCount(0);
}

/** Request a magic link and follow it from Mailpit. */
export async function magicLinkSignIn(page: Page, email: string, requestUrl: string, fill: (p: Page) => Promise<void>) {
  await page.goto(requestUrl);
  await fill(page);
  await expect(page).toHaveURL(/check-email/);
  const mail = await waitForMail(email, /sign-in link/i);
  await page.goto(linkIn(mail.Text, /https?:\/\/\S+\/api\/auth\/magic-link\/verify\S+/));
}

export async function poll<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 60_000, everyMs = 750): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
