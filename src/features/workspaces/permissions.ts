// Shared (client + server) permission matrix. See docs/SPEC.md §4.
export type Role = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";

const WEIGHT: Record<Role, number> = { GUEST: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

export const atLeast = (role: Role, min: Role) => WEIGHT[role] >= WEIGHT[min];

export const can = {
  read: (_role: Role) => true,
  edit: (role: Role) => atLeast(role, "MEMBER"),
  purge: (role: Role) => atLeast(role, "ADMIN"),
  manageMembers: (role: Role) => atLeast(role, "ADMIN"),
  manageWorkspace: (role: Role) => atLeast(role, "ADMIN"),
  deleteWorkspace: (role: Role) => role === "OWNER",
};

/** Whether `actor` may assign `target` role to someone currently holding `current`. */
export function canChangeRole(actor: Role, current: Role, target: Role): boolean {
  if (!can.manageMembers(actor)) return false;
  if (actor === "OWNER") return true;
  // Admins can't touch owners and can't create owners.
  return current !== "OWNER" && target !== "OWNER";
}

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  GUEST: "Guest",
};
