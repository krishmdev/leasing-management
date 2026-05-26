"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { cx } from "@/lib/cx";

interface Item {
  href: string;
  label: string;
  badge?: number;
  badgeTone?: "bad";
}

export function DeskNav({
  items,
  agencies,
  current,
  user,
  signOut,
}: {
  items: Item[];
  agencies: { slug: string; name: string }[];
  current: { slug: string; name: string };
  user: { name: string; role: string };
  signOut: () => Promise<void>;
}) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href.split("/").length <= 3 ? path === href : path.startsWith(href));

  const nav = (
    <nav aria-label="Desk" className="flex flex-col gap-0.5">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          onClick={() => setOpen(false)}
          aria-current={active(i.href) ? "page" : undefined}
          className={cx(
            "flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px]",
            active(i.href) ? "bg-ink text-white" : "text-ink-2 hover:bg-black/5",
          )}
        >
          {i.label}
          {!!i.badge && (
            <span className={cx("rounded px-1.5 font-mono text-2xs", i.badgeTone === "bad" ? "bg-bad text-white" : active(i.href) ? "bg-white/20" : "bg-black/10")}>{i.badge}</span>
          )}
        </Link>
      ))}
    </nav>
  );

  const header = (
    <div className="space-y-3">
      <p className="font-mono text-2xs uppercase tracking-[0.2em] text-muted">Leasing Desk</p>
      <label className="block">
        <span className="sr-only">Agency</span>
        <select
          value={current.slug}
          onChange={(e) => router.push(`/dashboard/${e.target.value}`)}
          className="w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-[13px] font-medium"
          disabled={agencies.length < 2}
        >
          {agencies.map((a) => (
            <option key={a.slug} value={a.slug}>{a.name}</option>
          ))}
        </select>
      </label>
    </div>
  );

  const footer = (
    <div className="border-t border-line pt-3 text-xs">
      <p className="font-medium text-ink">{user.name}</p>
      <p className="text-muted capitalize">{user.role}</p>
      <div className="mt-2 flex gap-3">
        <a href={`/${current.slug}`} className="text-muted underline-offset-2 hover:underline" target="_blank" rel="noreferrer">Public site ↗</a>
        <form action={signOut}>
          <button className="text-muted underline-offset-2 hover:underline">Sign out</button>
        </form>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col justify-between border-r border-line bg-[#efede7] p-4 md:flex">
        <div className="space-y-5">
          {header}
          {nav}
        </div>
        {footer}
      </aside>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-[#efede7] px-4 py-2.5 md:hidden">
        <span className="text-sm font-semibold">{current.name}</span>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="desk-mobile" className="rounded-md border border-line-strong px-2.5 py-1 text-[13px]">
          Menu
        </button>
      </div>
      {open && (
        <div id="desk-mobile" className="space-y-4 border-b border-line bg-[#efede7] p-4 md:hidden">
          {header}
          {nav}
          {footer}
        </div>
      )}
    </>
  );
}
