// Preset page covers: soft, original gradients (no external images).
export const COVER_PRESETS: Record<string, { label: string; css: string }> = {
  dawn: { label: "Dawn", css: "linear-gradient(120deg, #f6d5c3 0%, #e9b7c9 45%, #b9b4e8 100%)" },
  sage: { label: "Sage", css: "linear-gradient(135deg, #dfe8d6 0%, #a9c5a0 55%, #6f9a7f 100%)" },
  dusk: { label: "Dusk", css: "linear-gradient(120deg, #2c2f4a 0%, #5b5bd6 60%, #a68ad9 100%)" },
  sand: { label: "Sand", css: "linear-gradient(135deg, #f4ead9 0%, #e5cfa9 60%, #c9a876 100%)" },
  ocean: { label: "Ocean", css: "linear-gradient(120deg, #c9e6f0 0%, #6fb3d2 50%, #2f6f9a 100%)" },
  ember: { label: "Ember", css: "linear-gradient(135deg, #fbd6a5 0%, #f08a5d 55%, #b83b5e 100%)" },
  graphite: { label: "Graphite", css: "linear-gradient(135deg, #3a3d45 0%, #23252b 100%)" },
  bone: { label: "Bone", css: "radial-gradient(circle at 20% 30%, #ffffff 0%, #ede7dc 60%, #d9d0c1 100%)" },
};

export function coverStyle(cover: string): React.CSSProperties {
  if (cover.startsWith("preset:")) {
    return { background: COVER_PRESETS[cover.slice(7)]?.css ?? COVER_PRESETS.bone.css };
  }
  return {};
}
