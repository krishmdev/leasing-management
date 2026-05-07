import type { OutgoingEmail } from "./transport";

const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

interface Block {
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  footer?: string;
  brand?: { name: string; color?: string };
}

export function render(to: string, subject: string, b: Block, extra: Partial<OutgoingEmail> = {}): OutgoingEmail {
  const color = b.brand?.color ?? "#1f2937";
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1917">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden">
<tr><td style="background:${color};color:#fff;padding:16px 24px;font-weight:600">${esc(b.brand?.name ?? "Leasing Desk")}</td></tr>
<tr><td style="padding:24px"><h1 style="font-size:20px;margin:0 0 12px">${esc(b.heading)}</h1>
${b.paragraphs.map((p) => `<p style="line-height:1.55;margin:0 0 12px">${esc(p)}</p>`).join("\n")}
${b.cta ? `<p style="margin:20px 0"><a href="${esc(b.cta.url)}" style="background:${color};color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${esc(b.cta.label)}</a></p><p style="font-size:12px;color:#57534e;word-break:break-all">${esc(b.cta.url)}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 24px;font-size:12px;color:#78716c;border-top:1px solid #e7e5e4">${esc(b.footer ?? "You are receiving this because you contacted a leasing agency that uses this platform.")}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [b.heading, "", ...b.paragraphs, ...(b.cta ? ["", `${b.cta.label}: ${b.cta.url}`] : []), "", b.footer ?? ""].join("\n");
  return { to, subject, html, text, ...extra };
}

export function magicLinkEmail({ to, url }: { to: string; url: string }) {
  return render(to, "Your sign-in link", {
    heading: "Sign in",
    paragraphs: ["Use the button below to sign in. The link works once and expires in 15 minutes."],
    cta: { label: "Sign in", url },
    footer: "If you didn't ask for this, you can ignore it.",
  });
}
