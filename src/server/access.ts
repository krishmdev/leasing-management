/** Staff roles and what they can do. The one place role checks are defined. */
export const ROLES = ["owner", "admin", "agent", "maintenance"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  "listings.write": ["owner", "admin", "agent"],
  "showings.manage": ["owner", "admin", "agent"],
  "applications.read": ["owner", "admin", "agent"],
  "applications.decide": ["owner", "admin", "agent"],
  "pii.reveal": ["owner", "admin", "agent"],
  "settings.write": ["owner", "admin"],
  "automation.write": ["owner", "admin"],
  "audit.read": ["owner", "admin"],
  "maintenance.read": ["owner", "admin", "agent", "maintenance"],
  "maintenance.work": ["owner", "admin", "agent", "maintenance"],
  "residents.read": ["owner", "admin", "agent"],
  "metrics.read": ["owner", "admin", "agent"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: string, perm: Permission): boolean {
  return (PERMISSIONS[perm] as readonly string[]).includes(role);
}

export class ForbiddenError extends Error {
  constructor(perm: string) {
    super(`missing permission ${perm}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: string, perm: Permission) {
  if (!can(role, perm)) throw new ForbiddenError(perm);
}

/** Desk sections in nav order, with the permission each needs. */
export const DESK_SECTIONS: { path: string; label: string; perm: Permission }[] = [
  { path: "", label: "Overview", perm: "metrics.read" },
  { path: "/pipeline", label: "Pipeline", perm: "applications.read" },
  { path: "/applications", label: "Applications", perm: "applications.read" },
  { path: "/approvals", label: "Approvals", perm: "applications.decide" },
  { path: "/showings", label: "Showings", perm: "showings.manage" },
  { path: "/listings", label: "Listings", perm: "listings.write" },
  { path: "/maintenance", label: "Maintenance", perm: "maintenance.read" },
  { path: "/residents", label: "Residents", perm: "residents.read" },
  { path: "/audit", label: "Audit log", perm: "audit.read" },
  { path: "/settings", label: "Settings", perm: "settings.write" },
];

/** Where a role lands when it signs in: its first permitted section. */
export function homeFor(slug: string, role: string) {
  const s = DESK_SECTIONS.find((x) => can(role, x.perm));
  return `/dashboard/${slug}${s?.path ?? "/no-access"}`;
}
