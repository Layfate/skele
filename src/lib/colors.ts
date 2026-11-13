// Named colours shared by workspaces, projects, labels and select options.
export const COLORS = {
  gray: { hex: "#8a8580", label: "Gray" },
  graphite: { hex: "#4b5563", label: "Graphite" },
  indigo: { hex: "#5b5bd6", label: "Indigo" },
  blue: { hex: "#2f80ed", label: "Blue" },
  teal: { hex: "#14a3a3", label: "Teal" },
  green: { hex: "#30a46c", label: "Green" },
  amber: { hex: "#d99a0b", label: "Amber" },
  orange: { hex: "#e5652e", label: "Orange" },
  rose: { hex: "#e5484d", label: "Rose" },
  violet: { hex: "#8e4ec6", label: "Violet" },
} as const;

export type ColorName = keyof typeof COLORS;
export const COLOR_NAMES = Object.keys(COLORS) as ColorName[];

export function colorHex(name: string | null | undefined): string {
  return (COLORS as Record<string, { hex: string }>)[name ?? ""]?.hex ?? COLORS.gray.hex;
}

/** Accent presets for the app chrome (user preference). */
export const ACCENTS: ColorName[] = ["indigo", "blue", "teal", "green", "amber", "orange", "rose", "violet", "graphite"];
