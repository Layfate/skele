// Property-type registry shared by client and server.
// Adding a new type = add it to the Prisma enum and add one entry here.
import { z } from "zod";
import { isSafeUrl } from "@/features/editor/doc";

export type PropertyType =
  | "TEXT"
  | "NUMBER"
  | "SELECT"
  | "MULTI_SELECT"
  | "CHECKBOX"
  | "DATE"
  | "URL"
  | "EMAIL"
  | "PERSON"
  | "STATUS";

export type SelectOption = { id: string; name: string; color: string };
export type PropertyConfig = { options?: SelectOption[]; format?: "number" | "percent" | "currency" };
export type Property = { id: string; name: string; type: PropertyType; config: PropertyConfig; rank: string };
export type RecordValues = Record<string, unknown>;

export const optionSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(100),
  color: z.string().max(20),
});

const configSchemas: Record<PropertyType, z.ZodType<PropertyConfig>> = {
  TEXT: z.object({}).strip(),
  NUMBER: z.object({ format: z.enum(["number", "percent", "currency"]).optional() }).strip(),
  SELECT: z.object({ options: z.array(optionSchema).max(200).default([]) }).strip(),
  MULTI_SELECT: z.object({ options: z.array(optionSchema).max(200).default([]) }).strip(),
  STATUS: z.object({ options: z.array(optionSchema).min(1).max(50) }).strip(),
  CHECKBOX: z.object({}).strip(),
  DATE: z.object({}).strip(),
  URL: z.object({}).strip(),
  EMAIL: z.object({}).strip(),
  PERSON: z.object({}).strip(),
};

export function parseConfig(type: PropertyType, config: unknown): PropertyConfig {
  return configSchemas[type].parse(config ?? {});
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/, "Invalid date");

/**
 * Validates and normalises a single value for a property. `null` clears the value.
 * `memberIds` (server) validates PERSON values against workspace membership.
 */
export function validateValue(
  prop: Pick<Property, "type" | "config">,
  value: unknown,
  memberIds?: Set<string>,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  const optionIds = new Set((prop.config.options ?? []).map((o) => o.id));
  switch (prop.type) {
    case "TEXT":
      return typeof value === "string" && value.length <= 5000 ? { ok: true, value } : { ok: false, error: "Text is too long" };
    case "NUMBER":
      return typeof value === "number" && Number.isFinite(value) ? { ok: true, value } : { ok: false, error: "Not a number" };
    case "CHECKBOX":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, error: "Not a boolean" };
    case "SELECT":
    case "STATUS":
      return typeof value === "string" && optionIds.has(value) ? { ok: true, value } : { ok: false, error: "Unknown option" };
    case "MULTI_SELECT":
      if (!Array.isArray(value) || value.length > 100) return { ok: false, error: "Invalid options" };
      if (!value.every((v) => typeof v === "string" && optionIds.has(v))) return { ok: false, error: "Unknown option" };
      return { ok: true, value: [...new Set(value)] };
    case "DATE":
      return isoDate.safeParse(value).success && !Number.isNaN(Date.parse(value as string))
        ? { ok: true, value }
        : { ok: false, error: "Invalid date" };
    case "URL": {
      if (typeof value !== "string") return { ok: false, error: "Invalid URL" };
      const url = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
      return isSafeUrl(url) ? { ok: true, value: url } : { ok: false, error: "Invalid URL" };
    }
    case "EMAIL":
      return z.email().safeParse(value).success ? { ok: true, value } : { ok: false, error: "Invalid email" };
    case "PERSON":
      if (typeof value !== "string") return { ok: false, error: "Invalid person" };
      if (memberIds && !memberIds.has(value)) return { ok: false, error: "Not a workspace member" };
      return { ok: true, value };
  }
}

export function defaultStatusOptions(): SelectOption[] {
  return [
    { id: "todo", name: "Not started", color: "gray" },
    { id: "doing", name: "In progress", color: "blue" },
    { id: "done", name: "Done", color: "green" },
  ];
}

export function defaultConfig(type: PropertyType): PropertyConfig {
  if (type === "STATUS") return { options: defaultStatusOptions() };
  if (type === "SELECT" || type === "MULTI_SELECT") return { options: [] };
  if (type === "NUMBER") return { format: "number" };
  return {};
}

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  SELECT: "Select",
  MULTI_SELECT: "Multi-select",
  STATUS: "Status",
  CHECKBOX: "Checkbox",
  DATE: "Date",
  URL: "URL",
  EMAIL: "Email",
  PERSON: "Person",
};

export const PROPERTY_TYPES = Object.keys(PROPERTY_TYPE_LABEL) as PropertyType[];

export const hasOptions = (type: PropertyType) => type === "SELECT" || type === "MULTI_SELECT" || type === "STATUS";
