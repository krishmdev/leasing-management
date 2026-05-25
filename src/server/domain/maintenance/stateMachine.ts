export type TicketStatus = "NEW" | "TRIAGED" | "ASSIGNED" | "IN_PROGRESS" | "ON_HOLD" | "RESOLVED" | "CLOSED" | "CANCELED";

const NEXT: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["TRIAGED", "CANCELED"],
  TRIAGED: ["ASSIGNED", "CANCELED"],
  ASSIGNED: ["IN_PROGRESS", "ON_HOLD"],
  IN_PROGRESS: ["ON_HOLD", "RESOLVED"],
  ON_HOLD: ["IN_PROGRESS"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"], // reopen goes back to IN_PROGRESS
  CLOSED: ["IN_PROGRESS"],
  CANCELED: [],
};

export function canTransition(from: TicketStatus, to: TicketStatus) {
  return NEXT[from].includes(to);
}

export function nextStatuses(from: TicketStatus) {
  return NEXT[from];
}
