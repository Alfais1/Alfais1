// Edgerunners palette. Change these and rebuild — every SVG picks them up.
export const T = {
  bg: "#08080C",        // Night City black
  panel: "#0E0E14",
  panel2: "#13131B",
  line: "#22222E",
  lineSoft: "#1A1A24",
  yellow: "#F5E900",    // David's jacket
  cyan: "#00F0FF",      // Lucy
  magenta: "#FF2A6D",   // Rebecca / neon sign
  green: "#3DFF8C",
  text: "#EDEDF3",
  muted: "#8A8A9C",
  dim: "#4A4A5C",
  wash: "#070B18",      // navy wash laid over the banner painting so type stays readable
};

export const FONT =
  "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'DejaVu Sans Mono', monospace";

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// deterministic PRNG so the banner stars never change between builds
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
