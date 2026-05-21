const base = () => process.env.MAILPIT_URL ?? "http://127.0.0.1:8041";

export interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  Attachments: number;
}

export async function searchMail(query: string): Promise<MailSummary[]> {
  const res = await fetch(`${base()}/api/v1/search?query=${encodeURIComponent(query)}&limit=200`);
  if (!res.ok) throw new Error(`mailpit search ${res.status}`);
  return ((await res.json()) as { messages: MailSummary[] }).messages;
}

export async function mailTo(address: string) {
  return searchMail(`to:"${address}"`);
}

export async function messageText(id: string): Promise<{ Text: string; HTML: string; Attachments: { FileName: string; ContentType: string; PartID: string }[] }> {
  const res = await fetch(`${base()}/api/v1/message/${id}`);
  return res.json();
}

export async function waitForMail(address: string, count = 1, timeoutMs = 10_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const m = await mailTo(address);
    if (m.length >= count || Date.now() > until) return m;
    await new Promise((r) => setTimeout(r, 200));
  }
}
