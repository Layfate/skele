import { z } from "zod";
import { PROPERTY_TYPES, type PropertyType } from "./properties";
import { viewConfigSchema } from "./query";

const id = z.string().min(1).max(64);
const propertyType = z.enum(PROPERTY_TYPES as [PropertyType, ...PropertyType[]]);

export const createPropertySchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: propertyType,
  config: z.unknown().optional(),
});

export const updatePropertySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  type: propertyType.optional(),
  config: z.unknown().optional(),
  /** Move between two neighbours. */
  beforeId: id.nullish(),
  afterId: id.nullish(),
});

export const createRecordSchema = z.object({
  title: z.string().max(500).optional(),
  values: z.record(z.string(), z.unknown()).optional(),
  afterId: id.nullish(),
  /** Insert at the top instead of the end. */
  atStart: z.boolean().optional(),
});

export const updateRecordSchema = z.object({
  title: z.string().max(500).optional(),
  icon: z.string().max(32).nullable().optional(),
  /** Partial: only the given property ids change. */
  values: z.record(z.string(), z.unknown()).optional(),
});

export const moveRecordSchema = z.object({
  beforeId: id.nullish(),
  afterId: id.nullish(),
  /** e.g. the new group value when dragged across board columns. */
  values: z.record(z.string(), z.unknown()).optional(),
});

export const saveRecordContentSchema = z.object({
  doc: z.record(z.string(), z.unknown()),
  version: z.number().int().min(0),
});

export const viewTypeSchema = z.enum(["TABLE", "BOARD", "CALENDAR", "GALLERY", "LIST"]);

export const createViewSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: viewTypeSchema,
  config: viewConfigSchema.partial().optional(),
});

export const updateViewSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  type: viewTypeSchema.optional(),
  config: viewConfigSchema.partial().optional(),
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
export type CreateRecordInput = z.infer<typeof createRecordSchema>;
export type UpdateRecordInput = z.infer<typeof updateRecordSchema>;
export type MoveRecordInput = z.infer<typeof moveRecordSchema>;
export type CreateViewInput = z.infer<typeof createViewSchema>;
export type UpdateViewInput = z.infer<typeof updateViewSchema>;
