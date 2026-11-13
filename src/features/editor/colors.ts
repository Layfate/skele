// Theme-aware editor colours. Stored in documents as CSS variable references so they adapt to
// light/dark mode, and validated server-side (see sanitizeDoc) so styles can't be abused.

export const TEXT_COLORS = [
  { name: "default", label: "Default", value: null },
  { name: "gray", label: "Gray", value: "var(--tc-gray)" },
  { name: "red", label: "Red", value: "var(--tc-red)" },
  { name: "orange", label: "Orange", value: "var(--tc-orange)" },
  { name: "green", label: "Green", value: "var(--tc-green)" },
  { name: "blue", label: "Blue", value: "var(--tc-blue)" },
  { name: "purple", label: "Purple", value: "var(--tc-purple)" },
  { name: "pink", label: "Pink", value: "var(--tc-pink)" },
] as const;

export const HIGHLIGHT_COLORS = [
  { name: "none", label: "None", value: null },
  { name: "yellow", label: "Yellow", value: "var(--hl-yellow)" },
  { name: "green", label: "Green", value: "var(--hl-green)" },
  { name: "blue", label: "Blue", value: "var(--hl-blue)" },
  { name: "pink", label: "Pink", value: "var(--hl-pink)" },
  { name: "gray", label: "Gray", value: "var(--hl-gray)" },
] as const;

export const SAFE_COLOR = /^(var\(--(tc|hl)-[a-z]+\)|#[0-9a-fA-F]{3,8})$/;
