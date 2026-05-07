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
