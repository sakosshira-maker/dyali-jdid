// Rich page model for the notebook studio: formatted text, sticky notes,
// images, free drawing — all stored inside the page itself.

export type Orientation = "portrait" | "landscape";

/** A4 at 96 dpi, the reference canvas used on screen and when printing. */
export const SHEET = {
  portrait: { w: 794, h: 1123 },
  landscape: { w: 1123, h: 794 },
} as const;

export const sheetSize = (o: Orientation | undefined) => SHEET[o === "landscape" ? "landscape" : "portrait"];

export interface StickyNote { id: string; text: string; color: string; x: number; y: number; w: number; rot: number }
export interface PageImage { id: string; src: string; x: number; y: number; w: number; rot: number }
export interface Stroke { id: string; d: string; color: string; width: number }

export const NOTE_COLORS = ["#ffd6e8", "#e3dcff", "#fff3a6", "#d8f5d0", "#cdeffd", "#ffe3c2"];
export const TEXT_COLORS = ["#3b4a6b", "#d14d7e", "#6d4c9f", "#2f7d63", "#8a5a3b", "#7a3b69", "#33303e", "#d95f43"];
export const HIGHLIGHTS = ["#ffe9a8", "#ffc9e0", "#d7ccff", "#c6f0dc", "#cfe6ff", "#ffd5c2"];
export const PEN_COLORS = ["#d14d7e", "#6d4c9f", "#2f7d63", "#3b4a6b", "#e8a33d", "#33303e"];
export const TEXT_SIZES = [14, 16, 18, 21, 24, 28, 34, 42];

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* ───────── Safe HTML ───────── */

const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL", "BR", "DIV", "P", "SPAN", "UL", "OL", "LI", "H1", "H2", "H3", "BLOCKQUOTE", "MARK", "FONT", "SUB", "SUP"]);
const ALLOWED_STYLES = new Set(["color", "background-color", "font-size", "font-family", "font-weight", "font-style", "text-decoration", "text-decoration-line", "text-align", "line-height"]);

/**
 * Keeps only formatting markup. Scripts, event handlers and external
 * resources are removed — important because a restored backup file could
 * contain anything.
 */
export function sanitizeHtml(html: string): string {
  if (typeof window === "undefined" || !html) return "";
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      walk(child);
      if (child.tagName === "SCRIPT" || child.tagName === "STYLE" || child.tagName === "IFRAME" || child.tagName === "OBJECT") {
        child.remove();
        continue;
      }
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        if (name === "style") {
          const safe = attr.value
            .split(";")
            .map((rule) => rule.trim())
            .filter((rule) => {
              const prop = rule.split(":")[0]?.trim().toLowerCase();
              return prop && ALLOWED_STYLES.has(prop) && !/url\s*\(|expression|javascript:/i.test(rule);
            })
            .join("; ");
          if (safe) child.setAttribute("style", safe);
          else child.removeAttribute("style");
        } else if (!["color", "face", "size", "dir"].includes(name)) {
          child.removeAttribute(attr.name);
        }
      }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/** Plain text used by the French corrector, the summary check and search. */
export function htmlToText(html: string): string {
  if (typeof window === "undefined" || !html) return "";
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.body.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  doc.body.querySelectorAll("div, p, li, h1, h2, h3, blockquote").forEach((block) => block.append("\n"));
  return doc.body.textContent?.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim() ?? "";
}

export const escapeHtml = (value: string) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Older pages were plain text; they open seamlessly in the rich editor. */
export function textToHtml(text: string): string {
  if (!text) return "";
  return text.split("\n").map((line) => `<div>${line ? escapeHtml(line) : "<br>"}</div>`).join("");
}

/* ───────── A4 export ───────── */

const PAPER_CSS: Record<string, string> = {
  seyes: "background-image:linear-gradient(to right,transparent 0 44px,rgba(255,107,138,.45) 44px 46px,transparent 46px),repeating-linear-gradient(to bottom,transparent 0 31px,rgba(109,157,246,.5) 31px 32px),repeating-linear-gradient(to right,transparent 0 31px,rgba(109,157,246,.22) 31px 32px);",
  lignes: "background-image:linear-gradient(to right,transparent 0 44px,rgba(255,107,138,.45) 44px 46px,transparent 46px),repeating-linear-gradient(to bottom,transparent 0 31px,rgba(109,157,246,.55) 31px 32px);",
  points: "background-image:radial-gradient(rgba(155,126,222,.35) 1.6px,transparent 1.6px);background-size:24px 24px;",
  carreaux: "background-image:repeating-linear-gradient(to bottom,transparent 0 23px,rgba(255,158,199,.4) 23px 24px),repeating-linear-gradient(to right,transparent 0 23px,rgba(255,158,199,.4) 23px 24px);",
  blanc: "",
};

export interface PrintablePage {
  title: string;
  content: string;
  html?: string;
  paper: string;
  font: string;
  ink: string;
  fontSize: number;
  stickers?: Array<{ icon: string; x: number; y: number; color: string; size: number; rot: number }>;
  notes?: StickyNote[];
  images?: PageImage[];
  strokes?: Stroke[];
  orientation?: Orientation;
  sheets?: number;
}

/**
 * Builds a real A4 document: one sheet per page, exact millimetre sizes and
 * no cropping. The browser's print dialog then offers "Save as PDF".
 */
export function printPages(title: string, pages: PrintablePage[], moduleName: string) {
  if (typeof window === "undefined") return;
  const win = window.open("", "_blank");
  if (!win) throw new Error("Autorise la fenêtre d'impression dans ton navigateur, puis réessaie.");

  const body = pages.map((page) => {
    const o: Orientation = page.orientation === "landscape" ? "landscape" : "portrait";
    const size = sheetSize(o);
    const sheets = Math.max(1, Math.min(12, Math.round(page.sheets || 1)));
    const height = size.h * sheets;
    const inner = page.html ? sanitizeHtml(page.html) : textToHtml(page.content || "");
    const strokes = (page.strokes || []).map((s) => `<path d="${escapeHtml(s.d)}" fill="none" stroke="${escapeHtml(s.color)}" stroke-width="${Number(s.width) || 3}" stroke-linecap="round" stroke-linejoin="round" />`).join("");
    const images = (page.images || []).map((img) => `<img src="${escapeHtml(img.src)}" style="position:absolute;left:${img.x}px;top:${img.y}px;width:${img.w}px;transform:rotate(${img.rot}deg);border-radius:10px;" />`).join("");
    const notes = (page.notes || []).map((note) => `<div style="position:absolute;left:${note.x}px;top:${note.y}px;width:${note.w}px;transform:rotate(${note.rot}deg);background:${escapeHtml(note.color)};padding:12px 14px;border-radius:4px 4px 18px 4px;font-family:'Caveat',cursive;font-size:19px;line-height:1.35;color:#5b4a3b;box-shadow:0 6px 12px -6px rgba(120,80,20,.4);white-space:pre-wrap;">${escapeHtml(note.text)}</div>`).join("");

    return `<section class="sheet ${o}" style="width:${size.w}px;height:${height}px;${PAPER_CSS[page.paper] ?? ""}">
      <h2 class="title">${escapeHtml(page.title)}</h2>
      <div class="content" style="font-family:'${escapeHtml(page.font)}',cursive,sans-serif;font-size:${Number(page.fontSize) || 21}px;color:${escapeHtml(page.ink)};">${inner}</div>
      <svg class="layer" viewBox="0 0 ${size.w} ${height}" width="${size.w}" height="${height}">${strokes}</svg>
      ${images}${notes}
    </section>`;
  }).join("");

  win.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Dancing+Script:wght@600&family=Patrick+Hand&family=Kalam&family=Marhey&family=Tajawal:wght@500;700&family=Quicksand:wght@600&display=swap" rel="stylesheet">
  <style>
    @page { size: A4 portrait; margin: 0 }
    @page landscapePage { size: A4 landscape; margin: 0 }
    * { box-sizing: border-box }
    body { margin: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact }
    .sheet { position: relative; overflow: hidden; background-color: #fffef9; padding: 56px 52px 48px; page-break-after: always; break-after: page }
    .sheet:last-child { page-break-after: auto; break-after: auto }
    .sheet.landscape { page: landscapePage }
    .title { margin: 0 0 14px; font-family: 'Dancing Script', cursive; font-size: 30px; color: #d14d7e; border-bottom: 2px dashed #f3c6de; padding-bottom: 8px }
    .content { position: relative; z-index: 1; line-height: 1.6; word-wrap: break-word }
    .content ul, .content ol { padding-inline-start: 26px; margin: 6px 0 }
    .content h1 { font-size: 1.5em } .content h2 { font-size: 1.3em } .content h3 { font-size: 1.15em }
    .content mark { padding: 0 2px; border-radius: 3px }
    .layer { position: absolute; inset: 0; pointer-events: none; z-index: 2 }
    @media screen { body { background: #f4e9f1; padding: 18px } .sheet { margin: 0 auto 18px; box-shadow: 0 10px 30px -14px rgba(120,70,110,.5) } }
  </style></head><body>${body}
  <script>window.addEventListener('load', function () { setTimeout(function () { window.focus(); window.print(); }, 600); });</script>
  </body></html>`);
  win.document.close();
}
