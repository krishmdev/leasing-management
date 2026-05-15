import { createEvent, type EventAttributes } from "ics";

export interface IcsInput {
  uid: string;
  sequence: number;
  method: "REQUEST" | "CANCEL";
  start: Date;
  end: Date;
  title: string;
  location: string;
  description: string;
  organizer: { name: string; email: string };
  url?: string;
}

const utcParts = (d: Date): [number, number, number, number, number] => [
  d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(),
];

/**
 * Stable UID per showing; SEQUENCE goes up on every reschedule so calendar clients replace the
 * old event, and METHOD:CANCEL with the same UID removes it.
 */
export function buildIcs(i: IcsInput): string {
  const attrs: EventAttributes = {
    uid: i.uid,
    sequence: i.sequence,
    method: i.method,
    start: utcParts(i.start),
    startInputType: "utc",
    startOutputType: "utc",
    end: utcParts(i.end),
    endInputType: "utc",
    endOutputType: "utc",
    title: i.title,
    location: i.location,
    description: i.description,
    organizer: i.organizer,
    status: i.method === "CANCEL" ? "CANCELLED" : "CONFIRMED",
    productId: "leasing-management/ics",
    ...(i.url ? { url: i.url } : {}),
  };
  const { error, value } = createEvent(attrs);
  if (error || !value) throw error ?? new Error("ics generation failed");
  return value;
}
