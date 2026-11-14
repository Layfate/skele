// Colour themes (Settings → Appearance). Each theme has a light and a dark palette; the
// Light / Dark / System choice picks between them. The CSS is generated from this list and
// inlined in the page head (see app/layout.tsx), so the settings previews and the real
// colours come from the same values. "skele" is the built-in palette in globals.css.

export type Palette = {
  bg: string;
  fg: string;
  card: string;
  muted: string;
  mutedFg: string;
  accent: string;
  border: string;
  sidebar: string;
  sidebarFg: string;
  sidebarAccent: string;
  brand: string;
  brandFg: string;
};

export type ColorTheme = { id: string; label: string; description: string; light: Palette; dark: Palette };

const p = (
  bg: string,
  fg: string,
  card: string,
  muted: string,
  mutedFg: string,
  accent: string,
  border: string,
  sidebar: string,
  sidebarFg: string,
  sidebarAccent: string,
  brand: string,
  brandFg = "#ffffff",
): Palette => ({ bg, fg, card, muted, mutedFg, accent, border, sidebar, sidebarFg, sidebarAccent, brand, brandFg });

export const COLOR_THEMES: ColorTheme[] = [
  {
    id: "skele",
    label: "Skele",
    description: "Warm bone and cool graphite",
    light: p("#fcfbf9", "#2b2825", "#ffffff", "#f3f1ee", "#77716b", "#efede9", "#e5e2dd", "#f7f5f2", "#47423d", "#eae7e2", "#5b5bd6"),
    dark: p("#16171b", "#e9eaee", "#1c1d22", "#222329", "#a2a4ab", "#26272e", "#2a2b31", "#1a1b20", "#babcc3", "#25262d", "#6e6ee0"),
  },
  {
    id: "claude",
    label: "Claude",
    description: "Ivory paper and clay",
    light: p("#faf9f5", "#1f1e1d", "#ffffff", "#f0eee6", "#73726c", "#ebe9df", "#e3e0d6", "#f5f4ed", "#3d3d3a", "#e8e6dc", "#c96442"),
    dark: p("#262624", "#f5f4ef", "#30302e", "#30302e", "#a6a39a", "#3a3a37", "#3e3e3a", "#1f1e1d", "#c2c0b6", "#33332f", "#d97757"),
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    description: "Clean neutrals, green accent",
    light: p("#ffffff", "#0d0d0d", "#ffffff", "#f4f4f4", "#5d5d5d", "#ececec", "#e5e5e5", "#f9f9f9", "#0d0d0d", "#ececec", "#10a37f"),
    dark: p("#212121", "#ececec", "#2f2f2f", "#2f2f2f", "#b4b4b4", "#383838", "#373737", "#171717", "#ececec", "#262626", "#10a37f"),
  },
  {
    id: "vscode",
    label: "VS Code",
    description: "Light+ and Dark Modern",
    light: p("#ffffff", "#3b3b3b", "#f8f8f8", "#f3f3f3", "#616161", "#e8e8e8", "#e5e5e5", "#f8f8f8", "#3b3b3b", "#e4e6f1", "#005fb8"),
    dark: p("#1f1f1f", "#cccccc", "#252526", "#2b2b2b", "#9d9d9d", "#2a2d2e", "#2b2b2b", "#181818", "#cccccc", "#37373d", "#0078d4"),
  },
  {
    id: "github",
    label: "GitHub",
    description: "Primer light and dark",
    light: p("#ffffff", "#1f2328", "#ffffff", "#f6f8fa", "#59636e", "#eff2f5", "#d1d9e0", "#f6f8fa", "#1f2328", "#e8ecf0", "#0969da"),
    dark: p("#0d1117", "#f0f6fc", "#151b23", "#151b23", "#9198a1", "#212830", "#3d444d", "#010409", "#d1d7e0", "#1a2029", "#4493f8"),
  },
  {
    id: "one",
    label: "One",
    description: "Atom's One Light and One Dark",
    light: p("#fafafa", "#383a42", "#ffffff", "#f0f0f1", "#696c77", "#e5e5e6", "#dbdbdc", "#eaeaeb", "#383a42", "#dbdbdc", "#4078f2"),
    dark: p("#282c34", "#abb2bf", "#2c313a", "#2c313a", "#7f848e", "#323842", "#3a3f4b", "#21252b", "#abb2bf", "#2c313a", "#61afef", "#282c34"),
  },
  {
    id: "nord",
    label: "Nord",
    description: "Arctic, north-bluish",
    light: p("#eceff4", "#2e3440", "#f5f7fa", "#e5e9f0", "#4c566a", "#d8dee9", "#d8dee9", "#e5e9f0", "#3b4252", "#d8dee9", "#5e81ac"),
    dark: p("#2e3440", "#eceff4", "#3b4252", "#3b4252", "#a5adbd", "#434c5e", "#434c5e", "#292e39", "#d8dee9", "#3b4252", "#88c0d0", "#2e3440"),
  },
  {
    id: "dracula",
    label: "Dracula",
    description: "Alucard by day, Dracula by night",
    light: p("#fffbeb", "#1f1f1f", "#ffffff", "#efeddc", "#6c664b", "#e6e2cc", "#dedccf", "#f5f1de", "#1f1f1f", "#e6e2cc", "#644ac9"),
    dark: p("#282a36", "#f8f8f2", "#2f3140", "#343746", "#a0a6c8", "#44475a", "#44475a", "#21222c", "#f8f8f2", "#343746", "#bd93f9", "#282a36"),
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    description: "Latte and Mocha",
    light: p("#eff1f5", "#4c4f69", "#f7f8fb", "#e6e9ef", "#6c6f85", "#dce0e8", "#ccd0da", "#e6e9ef", "#4c4f69", "#dce0e8", "#8839ef"),
    dark: p("#1e1e2e", "#cdd6f4", "#262637", "#313244", "#a6adc8", "#313244", "#363749", "#181825", "#bac2de", "#313244", "#cba6f7", "#1e1e2e"),
  },
  {
    id: "tokyonight",
    label: "Tokyo Night",
    description: "Light and Night",
    light: p("#d5d6db", "#343b58", "#e6e7ed", "#cbccd1", "#565a6e", "#c4c8da", "#c1c2c7", "#cbccd1", "#343b58", "#c4c8da", "#34548a"),
    dark: p("#1a1b26", "#c0caf5", "#1f2335", "#24283b", "#9aa5ce", "#292e42", "#2f334d", "#16161e", "#a9b1d6", "#292e42", "#7aa2f7", "#1a1b26"),
  },
  {
    id: "rosepine",
    label: "Rosé Pine",
    description: "Dawn and Main",
    light: p("#faf4ed", "#575279", "#fffaf3", "#f2e9e1", "#797593", "#ebe3db", "#dfdad9", "#f2e9e1", "#575279", "#e8dfd6", "#907aa9"),
    dark: p("#191724", "#e0def4", "#1f1d2e", "#26233a", "#908caa", "#26233a", "#2e2b42", "#16141f", "#e0def4", "#26233a", "#c4a7e7", "#191724"),
  },
  {
    id: "solarized",
    label: "Solarized",
    description: "Precision colours, light and dark",
    light: p("#fdf6e3", "#4a5f67", "#fefaf0", "#eee8d5", "#6f8288", "#eee8d5", "#e4dcc5", "#eee8d5", "#4a5f67", "#e4dcc5", "#268bd2"),
    dark: p("#002b36", "#93a1a1", "#073642", "#073642", "#839496", "#0d4352", "#0f4555", "#00232c", "#93a1a1", "#073642", "#268bd2"),
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    description: "Retro groove",
    light: p("#fbf1c7", "#3c3836", "#fdf6d8", "#ebdbb2", "#7c6f64", "#ebdbb2", "#d5c4a1", "#f2e5bc", "#3c3836", "#ebdbb2", "#af3a03"),
    dark: p("#282828", "#ebdbb2", "#32302f", "#3c3836", "#a89984", "#3c3836", "#504945", "#1d2021", "#d5c4a1", "#3c3836", "#fe8019", "#282828"),
  },
];

export const COLOR_THEME_IDS = COLOR_THEMES.map((t) => t.id);

function vars(c: Palette) {
  return [
    `--background:${c.bg}`,
    `--foreground:${c.fg}`,
    `--card:${c.card}`,
    `--popover:${c.card}`,
    `--primary:${c.fg}`,
    `--primary-foreground:${c.bg}`,
    `--secondary:${c.muted}`,
    `--muted:${c.muted}`,
    `--muted-foreground:${c.mutedFg}`,
    `--accent:${c.accent}`,
    `--border:${c.border}`,
    `--input:${c.border}`,
    `--sidebar:${c.sidebar}`,
    `--sidebar-foreground:${c.sidebarFg}`,
    `--sidebar-accent:${c.sidebarAccent}`,
    `--sidebar-border:${c.border}`,
  ].join(";");
}

/** CSS for every theme except the built-in one. The theme's accent applies when the accent
 * preference is "theme"; any other accent overrides it. */
export function colorThemeCss() {
  return COLOR_THEMES.filter((t) => t.id !== "skele")
    .map((t) => {
      const sel = `html[data-color-theme="${t.id}"]`;
      return [
        `${sel}{${vars(t.light)}}`,
        `${sel}[data-accent="theme"]{--brand:${t.light.brand};--brand-foreground:${t.light.brandFg}}`,
        `html.dark[data-color-theme="${t.id}"]{${vars(t.dark)}}`,
        `html.dark[data-color-theme="${t.id}"][data-accent="theme"]{--brand:${t.dark.brand};--brand-foreground:${t.dark.brandFg}}`,
      ].join("\n");
    })
    .join("\n");
}
