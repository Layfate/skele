import { z } from "zod";
import { COLOR_NAMES } from "@/lib/colors";

const id = z.string().min(1).max(64);
const color = z.enum(COLOR_NAMES as [string, ...string[]]);
const date = z.iso.datetime({ offset: true }).or(z.iso.date());

export const TASK_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const PROJECT_STATUSES = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(5000).optional(),
  icon: z.string().max(16).nullish(),
  color: color.optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  startDate: date.nullish(),
  targetDate: date.nullish(),
  lead: z.string().trim().max(80).nullish(),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  archived: z.boolean().optional(),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).optional(),
  projectId: id.nullish(),
  parentId: id.nullish(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: date.nullish(),
  assignee: z.string().trim().max(80).nullish(),
  pageId: id.nullish(),
  labelIds: z.array(id).max(20).optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(20_000).optional(),
  projectId: id.nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: date.nullable().optional(),
  assignee: z.string().trim().max(80).nullable().optional(),
  pageId: id.nullable().optional(),
  labelIds: z.array(id).max(20).optional(),
});

export const moveTaskSchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  beforeId: id.nullish(),
  afterId: id.nullish(),
});

const csv = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : undefined))
    .pipe(z.array(item).optional());

export const taskQuerySchema = z.object({
  projectId: id.optional(),
  assignee: z.union([z.literal("me"), id]).optional(),
  status: csv(z.enum(TASK_STATUSES)),
  priority: csv(z.enum(TASK_PRIORITIES)),
  labelId: id.optional(),
  q: z.string().max(200).optional(),
  /** Include subtasks as top-level rows. */
  includeSubtasks: z.enum(["true", "false"]).optional(),
});

export const labelSchema = z.object({ name: z.string().trim().min(1).max(40), color: color.optional() });
export const commentSchema = z.object({ body: z.string().trim().min(1).max(5000) });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
export type TaskQuery = z.infer<typeof taskQuerySchema>;

export const STATUS_LABEL: Record<TaskStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
export const STATUS_COLOR: Record<TaskStatus, string> = {
  NOT_STARTED: "gray",
  IN_PROGRESS: "blue",
  ON_HOLD: "amber",
  COMPLETED: "green",
  CANCELLED: "rose",
};
export const PRIORITY_LABEL: Record<TaskPriority, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", URGENT: "Urgent" };
export const PRIORITY_COLOR: Record<TaskPriority, string> = { LOW: "gray", MEDIUM: "blue", HIGH: "orange", URGENT: "rose" };
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANNED: "Planned",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** completed ÷ (total − cancelled); null when there is nothing to measure. */
export function progress(counts: { total: number; completed: number; cancelled: number }): number | null {
  const denom = counts.total - counts.cancelled;
  return denom > 0 ? counts.completed / denom : null;
}
