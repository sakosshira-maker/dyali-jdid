import type React from "react";

export const DAYS = [
  { key: 1, label: "Lundi", short: "Lun" },
  { key: 2, label: "Mardi", short: "Mar" },
  { key: 3, label: "Mercredi", short: "Mer" },
  { key: 4, label: "Jeudi", short: "Jeu" },
  { key: 5, label: "Vendredi", short: "Ven" },
  { key: 6, label: "Samedi", short: "Sam" },
];

export const DAY_LABELS_FR: Record<number, string> = {
  1: "Lundi", 2: "Mardi", 3: "Mercredi", 4: "Jeudi", 5: "Vendredi", 6: "Samedi",
};

export const TIME_SLOTS = [
  "08:00", "09:00", "10:00", "11:00", "12:00",
  "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00",
];

export type ColorKey = "rose" | "lavande" | "ciel" | "menthe" | "orange" | "violet" | "soleil" | "peche";

export interface ThemeColor {
  bg: string;
  border: string;
  text: string;
  soft: string;
  solid: string;
}

export const COLOR_PALETTE: Record<ColorKey, ThemeColor> = {
  rose:    { bg: "#FFF0F6", border: "#FFB3D1", text: "#C2255C", soft: "#FFF7FB", solid: "#FF8FB8" },
  lavande: { bg: "#F4F0FF", border: "#CDB4F6", text: "#6741A8", soft: "#F9F6FF", solid: "#B79CED" },
  ciel:    { bg: "#EFF8FF", border: "#9FD8F5", text: "#17628F", soft: "#F4FBFF", solid: "#5FB3E6" },
  menthe:  { bg: "#F0FBF4", border: "#7FD6A8", text: "#1B7046", soft: "#F7FFFA", solid: "#4FC3A1" },
  orange:  { bg: "#FFF6EC", border: "#FFC79A", text: "#95531A", soft: "#FFFAF4", solid: "#FFAF70" },
  violet:  { bg: "#FBF2FF", border: "#E4B8F5", text: "#6E2F88", soft: "#FDF8FF", solid: "#C48AEA" },
  soleil:  { bg: "#FFFBE6", border: "#EFD68A", text: "#8A6A12", soft: "#FFFDF3", solid: "#E9C858" },
  peche:   { bg: "#FFF1EF", border: "#FFC1B6", text: "#A43C2C", soft: "#FFF8F6", solid: "#FF9C87" },
};

/** Convert #rrggbb to hsl-ish adjustments so any stored hex keeps a coherent pastel theme. */
function shade(hex: string, amount: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return hex;
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  const mix = (c: number, target: number, ratio: number) => Math.round(c + (target - c) * ratio);
  const ratio = Math.abs(amount) > 1 ? Math.abs(amount) / 100 : Math.abs(amount);
  const target = amount < 0 ? 0 : 255;
  const toHex = (c: number) => c.toString(16).padStart(2, "0");
  return `#${toHex(mix(r, target, ratio))}${toHex(mix(g, target, ratio))}${toHex(mix(b, target, ratio))}`;
}

const HEX_TO_KEY: Record<string, ColorKey> = {
  "#ffd6e8": "rose", "#f9d5ec": "rose", "#ffd9d9": "peche", "#ffe3c2": "orange",
  "#e3dcff": "lavande", "#cdeffd": "ciel", "#dce9ff": "ciel", "#d8f5d0": "menthe",
  "#d9f2ea": "menthe", "#fff3a6": "soleil",
};

export function getColor(key: string | undefined | null): ThemeColor {
  if (!key) return COLOR_PALETTE.rose;
  if (key.startsWith("#")) {
    const mapped = HEX_TO_KEY[key.toLowerCase()];
    if (mapped) return COLOR_PALETTE[mapped];
    return {
      bg: shade(key, 0.86),
      border: shade(key, -0.22),
      text: shade(key, -0.62),
      soft: shade(key, 0.92),
      solid: shade(key, -0.05),
    };
  }
  return COLOR_PALETTE[key as ColorKey] ?? COLOR_PALETTE.rose;
}

export interface CoverPattern { name: string; value: string }

/** Soft decorations for notebook covers. */
export const COVER_PATTERNS: CoverPattern[] = [
  { name: "Uni", value: "uni" },
  { name: "Pois", value: "pois" },
  { name: "Rayures", value: "rayures" },
  { name: "Petits cœurs", value: "coeurs" },
  { name: "Étoiles", value: "etoiles" },
  { name: "Carreaux", value: "carreaux" },
];

const DOT = (c: string) => `radial-gradient(${c} 2px, transparent 2px)`;

/** Inline background for a notebook cover: base colour + chosen motif. */
export function coverStyle(color: string | undefined, pattern: string | undefined): React.CSSProperties {
  const base = color || "#ffd6e8";
  const gradient = `linear-gradient(160deg, ${base}, #ffffff 130%)`;
  switch (pattern) {
    case "pois":
      return { backgroundImage: `${DOT("rgba(255,255,255,.75)")}, ${gradient}`, backgroundSize: "14px 14px, cover" };
    case "rayures":
      return { backgroundImage: `repeating-linear-gradient(45deg, rgba(255,255,255,.5) 0 6px, transparent 6px 14px), ${gradient}`, backgroundSize: "auto, cover" };
    case "coeurs":
      return {
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'%3E%3Cpath d='M11 17s-6-3.7-6-7.6C5 7.1 6.7 6 8.3 6c1 0 1.9.5 2.7 1.6C11.8 6.5 12.7 6 13.7 6 15.3 6 17 7.1 17 9.4 17 13.3 11 17 11 17z' fill='rgba(255,255,255,.65)'/%3E%3C/svg%3E"), ${gradient}`,
        backgroundSize: "22px 22px, cover",
      };
    case "etoiles":
      return {
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 26 26'%3E%3Cpath d='M13 5l1.8 4.2 4.2.4-3.2 2.9.9 4.5L13 14.8 9.3 17l.9-4.5L7 9.6l4.2-.4z' fill='rgba(255,255,255,.7)'/%3E%3C/svg%3E"), ${gradient}`,
        backgroundSize: "26px 26px, cover",
      };
    case "carreaux":
      return {
        backgroundImage: `repeating-linear-gradient(to bottom, rgba(255,255,255,.55) 0 1px, transparent 1px 13px), repeating-linear-gradient(to right, rgba(255,255,255,.55) 0 1px, transparent 1px 13px), ${gradient}`,
        backgroundSize: "auto, auto, cover",
      };
    default:
      return { backgroundImage: gradient };
  }
}

export const NOTEBOOK_COVERS = [
  "#ffd6e8", "#e3dcff", "#cdeffd", "#d8f5d0", "#ffe3c2", "#ffd9d9", "#fff3a6", "#d9f2ea",
];

export const QUOTES_FR = [
  { text: "Bonjour, future professeure de français ! Le savoir est la seule matière qui s'accroît quand on la partage.", author: "Coin motivation" },
  { text: "Chaque page écrite est un pas vers ton rêve d'enseigner le français avec passion.", author: "Mon petit cahier" },
  { text: "La patience et la régularité sont les meilleures alliées de la future professeure.", author: "Coin motivation" },
  { text: "Tu construis aujourd'hui les cours que tes élèves aimeront demain.", author: "Pensée du jour" },
  { text: "Le français est une langue vivante : fais-la vivre dans ton cœur avant de la faire vivre en classe.", author: "Inspiration" },
  { text: "Petit à petit, ton cahier devient un trésor. Continue, tu es sur le bon chemin.", author: "Hajiba, ta compagne" },
];

export function quoteOfTheDay() {
  const now = new Date();
  const day = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  return QUOTES_FR[day % QUOTES_FR.length];
}

/** Lundi = 1 … Samedi = 6 ; dimanche = 0 (aucune séance) */
export function todayIdx(): number {
  return new Date().getDay();
}

export function dateStrFr(): string {
  return new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}
