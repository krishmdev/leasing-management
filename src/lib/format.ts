export const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const bedsLabel = (beds: number) => (beds === 0 ? "Studio" : `${beds} bd`);
export const bathsLabel = (baths: number) => `${Number.isInteger(baths) ? baths : baths.toFixed(1)} ba`;

export function dateLabel(d: Date | string, tz = "America/Los_Angeles", opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  return new Date(d).toLocaleDateString("en-US", { timeZone: tz, ...opts });
}

/** Dates stored as @db.Date come back as UTC midnight; format them in UTC. */
export const dayLabel = (d: Date | string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(d).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });

export function timeLabel(d: Date | string, tz = "America/Los_Angeles") {
  return new Date(d).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
}

export function relative(from: Date, to = new Date()) {
  const mins = Math.round((from.getTime() - to.getTime()) / 60000);
  const abs = Math.abs(mins);
  if (abs < 1) return "just now";
  const s = abs < 60 ? `${abs}m` : abs < 60 * 24 ? `${Math.round(abs / 60)}h` : `${Math.round(abs / 1440)}d`;
  return mins >= 0 ? `in ${s}` : `${s} ago`;
}
