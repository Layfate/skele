import { z } from "zod";
import { ACCENTS } from "@/lib/colors";

export const dashboardWidgetIds = [
  "recent",
  "favorites",
  "tasks",
  "deadlines",
  "projects",
  "quickNote",
] as const;
export type DashboardWidgetId = (typeof dashboardWidgetIds)[number];

export const dashboardConfigSchema = z.object({
  order: z.array(z.enum(dashboardWidgetIds)).max(20).optional(),
  hidden: z.array(z.enum(dashboardWidgetIds)).max(20).optional(),
});

export const notificationsSchema = z.object({
  assigned: z.boolean().optional(),
  dueSoon: z.boolean().optional(),
  mentions: z.boolean().optional(),
  invites: z.boolean().optional(),
});

export const updatePreferencesSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  accent: z.enum(ACCENTS as [string, ...string[]]).optional(),
  fontSize: z.enum(["small", "default", "large"]).optional(),
  dashboard: dashboardConfigSchema.optional(),
  notifications: notificationsSchema.optional(),
  recentSearches: z.array(z.string().max(200)).max(10).optional(),
  /** Set the quick note for one workspace. */
  quickNote: z.object({ workspaceId: z.string().min(1).max(64), text: z.string().max(10_000) }).optional(),
});

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
