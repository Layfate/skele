import { z } from "zod";
import { COLOR_NAMES } from "@/lib/colors";

export const roleSchema = z.enum(["OWNER", "ADMIN", "MEMBER", "GUEST"]);
const color = z.enum(COLOR_NAMES as [string, ...string[]]);
const emoji = z.string().trim().min(1).max(16);

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  icon: emoji.nullish(),
  color: color.optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  icon: emoji.nullable().optional(),
  color: color.optional(),
});

export const updateMemberSchema = z.object({ role: roleSchema });

export const createInvitationSchema = z.object({
  email: z.email().trim().toLowerCase().max(254),
  role: roleSchema.exclude(["OWNER"]).default("MEMBER"),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
