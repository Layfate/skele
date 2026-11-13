import { z } from "zod";

const id = z.string().min(1).max(64);

export const createPageSchema = z.object({
  parentId: id.nullish(),
  title: z.string().max(255).optional(),
  icon: z.string().max(32).nullish(),
  kind: z.enum(["DOCUMENT", "DATABASE"]).default("DOCUMENT"),
  /** Insert directly after this sibling (defaults to the end). */
  afterId: id.nullish(),
});

export const updatePageSchema = z.object({
  title: z.string().max(255).optional(),
  icon: z.string().max(32).nullable().optional(),
  cover: z.string().max(2048).nullable().optional(),
  coverPosition: z.number().int().min(0).max(100).optional(),
  pinned: z.boolean().optional(),
  fullWidth: z.boolean().optional(),
});

export const movePageSchema = z.object({
  parentId: id.nullable(),
  /** Neighbours in the destination list (either may be null at the ends). */
  beforeId: id.nullish(),
  afterId: id.nullish(),
});

export const saveContentSchema = z.object({
  doc: z.record(z.string(), z.unknown()),
  /** The version the client's edit was based on. */
  version: z.number().int().min(0),
});

export type CreatePageInput = z.infer<typeof createPageSchema>;
export type UpdatePageInput = z.infer<typeof updatePageSchema>;
export type MovePageInput = z.infer<typeof movePageSchema>;
