"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, AlignLeft, AlignCenter, AlignRight,
  Highlighter, Palette, Pencil, Eraser, StickyNote, ImagePlus, Type, RemoveFormatting,
  ZoomIn, ZoomOut, RotateCw, Trash2, MousePointer2, Plus, Minus, FileStack, Quote, Heading,
} from "lucide-react";
import type { PageT, Sticker } from "@/lib/app";
import {
  HIGHLIGHTS, NOTE_COLORS, PEN_COLORS, TEXT_COLORS, TEXT_SIZES, newId, sanitizeHtml, sheetSize,
  textToHtml, type Orientation, type PageImage, type Stroke, type StickyNote as Note,
} from "@/lib/page-content";
import { FONTS } from "@/lib/app";
import { sfx } from "@/lib/sound";
import { Icon } from "../ui";

type Mode = "text" | "draw" | "erase";
type Selection = { kind: "note" | "image" | "sticker"; id: string } | null;

interface Props {
  draft: PageT;
  upd: (patch: Partial<PageT>) => void;
  /** Receives the formatted text and its plain copy in a single update. */
  onWrite: (html: string, text: string) => void;
  paperClass: string;
  children?: React.ReactNode;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Toolbar buttons must not steal focus, otherwise the text selection is lost. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

export default function PageStudio({ draft, upd, onWrite, paperClass, children }: Props) {
  const orientation: Orientation = draft.orientation === "landscape" ? "landscape" : "portrait";
  const size = sheetSize(orientation);
  const sheets = clamp(Math.round(draft.sheets || 1), 1, 12);
  const height = size.h * sheets;

  const notes: Note[] = Array.isArray(draft.notes) ? draft.notes : [];
  const images: PageImage[] = Array.isArray(draft.images) ? draft.images : [];
  const strokes: Stroke[] = Array.isArray(draft.strokes) ? draft.strokes : [];
  const stickers: Sticker[] = Array.isArray(draft.stickers) ? draft.stickers : [];

  const [mode, setMode] = useState<Mode>("text");
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<Selection>(null);
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [penWidth, setPenWidth] = useState(3);
  const [openMenu, setOpenMenu] = useState<"color" | "highlight" | "size" | "font" | null>(null);
  const [imageError, setImageError] = useState("");

  const editorRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const strokeRef = useRef<{ id: string; points: Array<[number, number]> } | null>(null);
  const dragRef = useRef<null | { kind: "note" | "image" | "sticker"; id: string; action: "move" | "resize"; dx: number; dy: number; startW: number; startX: number }>(null);
  const loadedPage = useRef<number | null>(null);

  /* ───────── Rich text ───────── */

  // innerHTML is only written when the page changes, so the caret never jumps.
  useEffect(() => {
    const el = editorRef.current;
    if (!el || loadedPage.current === draft.id) return;
    loadedPage.current = draft.id;
    el.innerHTML = sanitizeHtml(draft.html || "") || textToHtml(draft.content || "");
    lastWritten.current = el.innerHTML;
    setSelected(null);
    setMode("text");
  }, [draft.id, draft.html, draft.content]);

  // Arrow keys and clicks also fire these handlers, so the content is compared
  // first: without this, simply moving the caret would mark the page modified
  // and flood React with updates while typing.
  const lastWritten = useRef<string | null>(null);
  const pushHtml = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    if (html === lastWritten.current) return;
    lastWritten.current = html;
    onWrite(html, el.innerText || "");
  }, [onWrite]);

  // document.execCommand is deprecated but remains the only formatting API
  // supported by every browser without adding a heavy editor dependency.
  const run = (command: string, value?: string) => {
    editorRef.current?.focus();
    try { document.execCommand("styleWithCSS", false, "true"); } catch { /* older engines */ }
    document.execCommand(command, false, value);
    pushHtml();
    sfx.pop();
  };

  const applyFontSize = (px: number) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    // execCommand only knows sizes 1-7, so we tag the selection with the largest
    // one and immediately swap that marker for the exact pixel size.
    try { document.execCommand("styleWithCSS", false, "false"); } catch { /* older engines */ }
    document.execCommand("fontSize", false, "7");
    const swap = (node: Element) => {
      const span = document.createElement("span");
      span.style.fontSize = `${px}px`;
      span.innerHTML = node.innerHTML;
      node.replaceWith(span);
    };
    el.querySelectorAll('font[size="7"]').forEach(swap);
    el.querySelectorAll<HTMLElement>('span[style*="xxx-large"]').forEach(swap);
    pushHtml();
    sfx.pop();
  };

  const applyFontFamily = (family: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    document.execCommand("fontName", false, family);
    el.querySelectorAll("font[face]").forEach((font) => {
      const span = document.createElement("span");
      span.style.fontFamily = `'${font.getAttribute("face")}', cursive, sans-serif`;
      span.innerHTML = font.innerHTML;
      font.replaceWith(span);
    });
    pushHtml();
    sfx.pop();
  };

  const highlight = (color: string) => {
    editorRef.current?.focus();
    try { document.execCommand("styleWithCSS", false, "true"); } catch { /* older engines */ }
    if (!document.execCommand("hiliteColor", false, color)) document.execCommand("backColor", false, color);
    pushHtml();
    sfx.pop();
  };

  // Pasted content keeps its formatting but never its scripts or styles sheets.
  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (html) document.execCommand("insertHTML", false, sanitizeHtml(html));
    else document.execCommand("insertText", false, text);
    pushHtml();
  };

  /* ───────── Drawing ───────── */

  const pointIn = (e: React.PointerEvent): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [clamp((e.clientX - rect.left) / zoom, 0, size.w), clamp((e.clientY - rect.top) / zoom, 0, height)];
  };

  const pathFrom = (points: Array<[number, number]>) => {
    if (points.length < 2) {
      const [x, y] = points[0] ?? [0, 0];
      return `M${x.toFixed(1)} ${y.toFixed(1)} l0.1 0.1`;
    }
    // Smooth the line through the midpoints so handwriting looks natural.
    let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
    for (let i = 1; i < points.length - 1; i++) {
      const [cx, cy] = points[i];
      const [nx, ny] = points[i + 1];
      d += ` Q${cx.toFixed(1)} ${cy.toFixed(1)} ${((cx + nx) / 2).toFixed(1)} ${((cy + ny) / 2).toFixed(1)}`;
    }
    const last = points[points.length - 1];
    return `${d} L${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
  };

  const eraseAt = (x: number, y: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const point = svg.createSVGPoint();
    point.x = x; point.y = y;
    const hit: string[] = [];
    svg.querySelectorAll<SVGPathElement>("path[data-id]").forEach((path) => {
      if (path.isPointInStroke(point)) hit.push(path.dataset.id!);
    });
    if (hit.length) upd({ strokes: strokes.filter((s) => !hit.includes(s.id)) });
  };

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (mode === "text") return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const [x, y] = pointIn(e);
    if (mode === "erase") { eraseAt(x, y); return; }
    strokeRef.current = { id: newId(), points: [[x, y]] };
    upd({ strokes: [...strokes, { id: strokeRef.current.id, d: pathFrom(strokeRef.current.points), color: penColor, width: penWidth }] });
  };

  const onCanvasPointerMove = (e: React.PointerEvent) => {
    if (mode === "text") return;
    const [x, y] = pointIn(e);
    if (mode === "erase") { if (e.buttons === 1) eraseAt(x, y); return; }
    const current = strokeRef.current;
    if (!current || e.buttons !== 1) return;
    current.points.push([x, y]);
    const d = pathFrom(current.points);
    upd({ strokes: strokes.map((s) => (s.id === current.id ? { ...s, d } : s)) });
  };

  const onCanvasPointerUp = () => {
    if (strokeRef.current) { strokeRef.current = null; sfx.pop(); }
  };

  /* ───────── Notes, images, stickers ───────── */

  const addNote = () => {
    const note: Note = {
      id: newId(), text: "", color: NOTE_COLORS[notes.length % NOTE_COLORS.length],
      x: Math.round(size.w / 2 - 90 + (notes.length % 3) * 24), y: 150 + (notes.length % 4) * 28,
      w: 190, rot: Math.round(Math.random() * 6 - 3),
    };
    upd({ notes: [...notes, note] });
    setSelected({ kind: "note", id: note.id });
    setMode("text");
    sfx.stick();
  };

  const addImage = async (file: File) => {
    setImageError("");
    if (!file.type.startsWith("image/")) { setImageError("Choisis une image (JPG, PNG…)."); return; }
    if (file.size > 12 * 1024 * 1024) { setImageError("Image trop lourde : 12 Mo maximum."); return; }
    const url = URL.createObjectURL(file);
    try {
      // HTMLImageElement decoding works in every browser, including older Safari.
      const picture = new Image();
      picture.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        picture.onload = () => resolve();
        picture.onerror = () => reject(new Error("decode"));
        picture.src = url;
      });
      const naturalW = picture.naturalWidth || picture.width;
      const naturalH = picture.naturalHeight || picture.height;
      if (!naturalW || !naturalH) throw new Error("empty");
      const max = 1400;
      const scale = Math.min(1, max / Math.max(naturalW, naturalH));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(naturalW * scale));
      canvas.height = Math.max(1, Math.round(naturalH * scale));
      canvas.getContext("2d")!.drawImage(picture, 0, 0, canvas.width, canvas.height);
      const transparent = file.type === "image/png" || file.type === "image/webp";
      const src = canvas.toDataURL(transparent ? "image/png" : "image/jpeg", 0.85);
      const width = Math.min(320, size.w - 120);
      const image: PageImage = { id: newId(), src, x: Math.round(size.w / 2 - width / 2), y: 200, w: width, rot: 0 };
      upd({ images: [...images, image] });
      setSelected({ kind: "image", id: image.id });
      setMode("text");
      sfx.stick();
    } catch {
      setImageError("Cette image n'a pas pu être ouverte.");
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const startDrag = (e: React.PointerEvent, kind: "note" | "image" | "sticker", id: string, action: "move" | "resize") => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const [x, y] = pointIn(e);
    const item = kind === "note" ? notes.find((n) => n.id === id) : kind === "image" ? images.find((i) => i.id === id) : null;
    const sticker = kind === "sticker" ? stickers[Number(id)] : null;
    const itemX = item ? item.x : sticker ? (sticker.x / 100) * size.w : 0;
    const itemY = item ? item.y : sticker ? (sticker.y / 100) * height : 0;
    dragRef.current = { kind, id, action, dx: x - itemX, dy: y - itemY, startW: item ? item.w : sticker?.size ?? 34, startX: x };
    setSelected({ kind, id });
  };

  const onDragMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const [x, y] = pointIn(e);
    if (drag.action === "resize") {
      const delta = x - drag.startX;
      if (drag.kind === "note") upd({ notes: notes.map((n) => (n.id === drag.id ? { ...n, w: clamp(Math.round(drag.startW + delta), 120, 420) } : n)) });
      else if (drag.kind === "image") upd({ images: images.map((i) => (i.id === drag.id ? { ...i, w: clamp(Math.round(drag.startW + delta), 80, size.w) } : i)) });
      else upd({ stickers: stickers.map((s, i) => (String(i) === drag.id ? { ...s, size: clamp(Math.round(drag.startW + delta), 16, 160) } : s)) });
      return;
    }
    const nx = Math.round(x - drag.dx);
    const ny = Math.round(y - drag.dy);
    if (drag.kind === "note") upd({ notes: notes.map((n) => (n.id === drag.id ? { ...n, x: clamp(nx, -40, size.w - 60), y: clamp(ny, 0, height - 40) } : n)) });
    else if (drag.kind === "image") upd({ images: images.map((i) => (i.id === drag.id ? { ...i, x: clamp(nx, -60, size.w - 60), y: clamp(ny, 0, height - 40) } : i)) });
    else upd({ stickers: stickers.map((s, i) => (String(i) === drag.id ? { ...s, x: clamp((nx / size.w) * 100, 1, 99), y: clamp((ny / height) * 100, 1, 99) } : s)) });
  };

  const endDrag = () => { dragRef.current = null; };

  const rotateSelected = () => {
    if (!selected) return;
    if (selected.kind === "note") upd({ notes: notes.map((n) => (n.id === selected.id ? { ...n, rot: (n.rot + 5) % 360 } : n)) });
    if (selected.kind === "image") upd({ images: images.map((i) => (i.id === selected.id ? { ...i, rot: (i.rot + 5) % 360 } : i)) });
    if (selected.kind === "sticker") upd({ stickers: stickers.map((s, i) => (String(i) === selected.id ? { ...s, rot: (s.rot + 10) % 360 } : s)) });
    sfx.pop();
  };

  const deleteSelected = () => {
    if (!selected) return;
    if (selected.kind === "note") upd({ notes: notes.filter((n) => n.id !== selected.id) });
    if (selected.kind === "image") upd({ images: images.filter((i) => i.id !== selected.id) });
    if (selected.kind === "sticker") upd({ stickers: stickers.filter((_, i) => String(i) !== selected.id) });
    setSelected(null);
    sfx.pop();
  };

  const toolBtn = (active: boolean) =>
    `flex h-8 min-w-8 items-center justify-center gap-1 rounded-xl border-2 px-2 text-[11px] font-bold transition ${active ? "border-[#d14d7e] bg-[#ffe3ef] text-[#c2255c]" : "border-[#f3d9e8] bg-white text-[#8a6d9e] hover:bg-[#fff6fb]"}`;

  return (
    <div className="space-y-2" onPointerMove={onDragMove} onPointerUp={endDrag} onPointerLeave={endDrag}>
      {/* ───── Formatting bar ───── */}
      <div className="cute-card sticky top-[64px] z-20 flex flex-wrap items-center gap-1.5 p-2">
        <button onMouseDown={keepFocus} onClick={() => run("bold")} className={toolBtn(false)} title="Gras (Ctrl+B)"><Bold size={14} /></button>
        <button onMouseDown={keepFocus} onClick={() => run("italic")} className={toolBtn(false)} title="Italique (Ctrl+I)"><Italic size={14} /></button>
        <button onMouseDown={keepFocus} onClick={() => run("underline")} className={toolBtn(false)} title="Souligné (Ctrl+U)"><Underline size={14} /></button>
        <button onMouseDown={keepFocus} onClick={() => run("strikeThrough")} className={toolBtn(false)} title="Barré"><Strikethrough size={14} /></button>

        <span className="mx-0.5 h-6 w-px bg-[#f3d9e8]" />
        <button onMouseDown={keepFocus} onClick={() => run("insertUnorderedList")} className={toolBtn(false)} title="Liste à puces"><List size={14} /></button>
        <button onMouseDown={keepFocus} onClick={() => run("insertOrderedList")} className={toolBtn(false)} title="Liste numérotée"><ListOrdered size={14} /></button>
        <button onMouseDown={keepFocus} onClick={() => run("formatBlock", "<h2>")} className={toolBtn(false)} title="Titre"><Heading size={14} /></button>
        <button onMouseDown={keepFocus} onClick={() => run("formatBlock", "<blockquote>")} className={toolBtn(false)} title="Citation"><Quote size={14} /></button>

        <span className="mx-0.5 h-6 w-px bg-[#f3d9e8]" />
        <button onMouseDown={keepFocus} onClick={() => run("justifyLeft")} className={toolBtn(false)} title="Aligner à gauche"><AlignLeft size={14} /></button>
        <button onMouseDown={keepFocus} onClick={() => run("justifyCenter")} className={toolBtn(false)} title="Centrer"><AlignCenter size={14} /></button>
        <button onMouseDown={keepFocus} onClick={() => run("justifyRight")} className={toolBtn(false)} title="Aligner à droite"><AlignRight size={14} /></button>

        <span className="mx-0.5 h-6 w-px bg-[#f3d9e8]" />
        {/* Font family */}
        <div className="relative">
          <button onMouseDown={keepFocus} onClick={() => setOpenMenu(openMenu === "font" ? null : "font")} className={toolBtn(openMenu === "font")} title="Police du texte sélectionné"><Type size={14} /> <span className="hidden sm:inline">Police</span></button>
          {openMenu === "font" && (
            <div className="absolute z-30 mt-1 w-52 rounded-2xl border-2 border-[#f3d9e8] bg-white p-1.5 shadow-xl">
              {FONTS.map((f) => (
                <button key={f.value} onMouseDown={keepFocus} onClick={() => { applyFontFamily(f.value); setOpenMenu(null); }}
                  className="block w-full rounded-xl px-2 py-1.5 text-right text-[12px] text-[#5b3a5e] hover:bg-[#fff0f6]" style={{ fontFamily: `'${f.value}', cursive` }}>
                  {f.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Font size */}
        <div className="relative">
          <button onMouseDown={keepFocus} onClick={() => setOpenMenu(openMenu === "size" ? null : "size")} className={toolBtn(openMenu === "size")} title="Taille du texte sélectionné">A<sup>±</sup></button>
          {openMenu === "size" && (
            <div className="absolute z-30 mt-1 w-24 rounded-2xl border-2 border-[#f3d9e8] bg-white p-1.5 shadow-xl">
              {TEXT_SIZES.map((s) => (
                <button key={s} onMouseDown={keepFocus} onClick={() => { applyFontSize(s); setOpenMenu(null); }}
                  className="block w-full rounded-xl px-2 py-1 text-[12px] font-bold text-[#5b3a5e] hover:bg-[#fff0f6]">{s} px</button>
              ))}
            </div>
          )}
        </div>
        {/* Text colour */}
        <div className="relative">
          <button onMouseDown={keepFocus} onClick={() => setOpenMenu(openMenu === "color" ? null : "color")} className={toolBtn(openMenu === "color")} title="Couleur du texte"><Palette size={14} /></button>
          {openMenu === "color" && (
            <div className="absolute z-30 mt-1 flex w-40 flex-wrap gap-1.5 rounded-2xl border-2 border-[#f3d9e8] bg-white p-2 shadow-xl">
              {TEXT_COLORS.map((c) => (
                <button key={c} onMouseDown={keepFocus} onClick={() => { run("foreColor", c); setOpenMenu(null); }}
                  aria-label={`Couleur ${c}`} className="h-7 w-7 rounded-full border-2 border-white shadow" style={{ background: c }} />
              ))}
            </div>
          )}
        </div>
        {/* Highlighter */}
        <div className="relative">
          <button onMouseDown={keepFocus} onClick={() => setOpenMenu(openMenu === "highlight" ? null : "highlight")} className={toolBtn(openMenu === "highlight")} title="Surligner"><Highlighter size={14} /></button>
          {openMenu === "highlight" && (
            <div className="absolute z-30 mt-1 flex w-40 flex-wrap gap-1.5 rounded-2xl border-2 border-[#f3d9e8] bg-white p-2 shadow-xl">
              {HIGHLIGHTS.map((c) => (
                <button key={c} onMouseDown={keepFocus} onClick={() => { highlight(c); setOpenMenu(null); }}
                  aria-label={`Surlignage ${c}`} className="h-7 w-7 rounded-lg border-2 border-white shadow" style={{ background: c }} />
              ))}
              <button onMouseDown={keepFocus} onClick={() => { highlight("transparent"); setOpenMenu(null); }}
                className="rounded-lg border-2 border-[#f3d9e8] px-2 text-[10px] font-bold text-[#8a6d9e]">Aucun</button>
            </div>
          )}
        </div>
        <button onMouseDown={keepFocus} onClick={() => run("removeFormat")} className={toolBtn(false)} title="Effacer la mise en forme"><RemoveFormatting size={14} /></button>
      </div>

      {/* ───── Tools bar ───── */}
      <div className="cute-card flex flex-wrap items-center gap-1.5 p-2">
        <button onClick={() => { setMode("text"); sfx.pop(); }} className={toolBtn(mode === "text")} title="Écrire"><MousePointer2 size={14} /> Écrire</button>
        <button onClick={() => { setMode("draw"); setSelected(null); sfx.pop(); }} className={toolBtn(mode === "draw")} title="Dessiner"><Pencil size={14} /> Dessiner</button>
        <button onClick={() => { setMode("erase"); setSelected(null); sfx.pop(); }} className={toolBtn(mode === "erase")} title="Gomme"><Eraser size={14} /> Gomme</button>

        {(mode === "draw" || mode === "erase") && (
          <span className="flex items-center gap-1.5 rounded-xl bg-[#fff6fb] px-2 py-1">
            {PEN_COLORS.map((c) => (
              <button key={c} onClick={() => { setPenColor(c); setMode("draw"); }} aria-label={`Stylo ${c}`}
                className={`h-5 w-5 rounded-full border-2 ${penColor === c && mode === "draw" ? "border-[#5b3a5e] scale-110" : "border-white"} shadow`} style={{ background: c }} />
            ))}
            <span className="mx-1 h-5 w-px bg-[#f3d9e8]" />
            <button onClick={() => setPenWidth((w) => clamp(w - 1, 1, 14))} className="text-[#8a6d9e]" aria-label="Trait plus fin"><Minus size={13} /></button>
            <span className="w-4 text-center text-[11px] font-bold text-[#8a6d9e]">{penWidth}</span>
            <button onClick={() => setPenWidth((w) => clamp(w + 1, 1, 14))} className="text-[#8a6d9e]" aria-label="Trait plus épais"><Plus size={13} /></button>
          </span>
        )}

        <span className="mx-0.5 h-6 w-px bg-[#f3d9e8]" />
        <button onClick={addNote} className={toolBtn(false)} title="Ajouter une note adhésive"><StickyNote size={14} /> Note</button>
        <button onClick={() => fileRef.current?.click()} className={toolBtn(false)} title="Ajouter une image"><ImagePlus size={14} /> Image</button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label="Choisir une image"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void addImage(f); e.target.value = ""; }} />

        {selected && (
          <span className="flex items-center gap-1 rounded-xl bg-[#f6f0ff] px-2 py-1">
            <span className="text-[10px] font-bold text-[#6d4c9f]">Élément choisi</span>
            <button onClick={rotateSelected} className="text-[#6d4c9f]" title="Pivoter"><RotateCw size={13} /></button>
            <button onClick={deleteSelected} className="text-red-400" title="Supprimer"><Trash2 size={13} /></button>
          </span>
        )}

        <span className="ms-auto flex items-center gap-1.5">
          <button onClick={() => upd({ orientation: orientation === "portrait" ? "landscape" : "portrait" })}
            className={toolBtn(false)} title="Orientation de la feuille">
            {orientation === "portrait" ? "Portrait" : "Paysage"}
          </button>
          <button onClick={() => upd({ sheets: clamp(sheets + 1, 1, 12) })} className={toolBtn(false)} title="Allonger la feuille (A4 supplémentaire)">
            <FileStack size={14} /> {sheets}
          </button>
          {sheets > 1 && (
            <button onClick={() => upd({ sheets: sheets - 1 })} className={toolBtn(false)} title="Raccourcir la feuille"><Minus size={13} /></button>
          )}
          <span className="mx-0.5 h-6 w-px bg-[#f3d9e8]" />
          <button onClick={() => setZoom((z) => clamp(Number((z - 0.1).toFixed(2)), 0.5, 1.5))} className={toolBtn(false)} aria-label="Réduire"><ZoomOut size={14} /></button>
          <span className="w-10 text-center text-[11px] font-bold text-[#8a6d9e]">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => clamp(Number((z + 0.1).toFixed(2)), 0.5, 1.5))} className={toolBtn(false)} aria-label="Agrandir"><ZoomIn size={14} /></button>
        </span>
      </div>
      {imageError && <p role="alert" className="text-xs font-bold text-rose-500">{imageError}</p>}

      {/* ───── A4 canvas ───── */}
      <div className="overflow-auto rounded-3xl bg-[#f6ecf4] p-3 sm:p-6">
        <div style={{ width: size.w * zoom, height: height * zoom, margin: "0 auto" }}>
          <div
            ref={canvasRef}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            data-page-canvas=""
            className={`anim-page relative overflow-hidden rounded-xl border border-[#eee0d8] shadow-[0_18px_40px_-20px_rgba(150,90,140,.5)] ${paperClass}`}
            style={{
              width: size.w, height, transform: `scale(${zoom})`, transformOrigin: "top left",
              cursor: mode === "draw" ? "crosshair" : mode === "erase" ? "cell" : "auto",
              touchAction: mode === "text" ? "auto" : "none",
            }}
          >
            {/* page-break guides */}
            {Array.from({ length: sheets - 1 }, (_, i) => (
              <div key={i} className="pointer-events-none absolute left-0 right-0 border-t-2 border-dashed border-[#e7c7dd]" style={{ top: size.h * (i + 1) }}>
                <span className="absolute -top-2.5 right-3 rounded-full bg-[#f6ecf4] px-2 text-[9px] font-bold text-[#b08cbb]">page {i + 2}</span>
              </div>
            ))}

            <div className="relative z-10 px-12 pt-10">
              <input
                value={draft.title}
                onChange={(e) => upd({ title: e.target.value })}
                dir="auto" lang="fr" spellCheck
                className="w-full border-b-2 border-dashed border-pink-200 bg-transparent pb-2 font-display text-2xl font-bold text-[#d14d7e] outline-none placeholder:text-pink-200"
                placeholder="Titre de la leçon…"
              />
              <div
                ref={editorRef}
                contentEditable={mode === "text"}
                suppressContentEditableWarning
                onInput={pushHtml}
                onBlur={pushHtml}
                onPaste={onPaste}
                dir="auto" lang="fr" spellCheck
                data-placeholder="Commence à écrire… tu peux tout mettre en forme, dessiner et coller des notes."
                className="page-editor mt-3 w-full outline-none"
                style={{
                  fontFamily: `'${draft.font}', cursive, sans-serif`,
                  fontSize: draft.fontSize,
                  color: draft.ink,
                  lineHeight: 1.6,
                  minHeight: height - 190,
                }}
              />
            </div>

            {/* drawing */}
            <svg ref={svgRef} viewBox={`0 0 ${size.w} ${height}`} width={size.w} height={height}
              className="pointer-events-none absolute inset-0 z-20">
              {strokes.map((s) => (
                <path key={s.id} data-id={s.id} d={s.d} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" />
              ))}
            </svg>

            {/* images */}
            {images.map((img) => {
              const active = selected?.kind === "image" && selected.id === img.id;
              return (
                <div key={img.id} className={`absolute z-30 ${active ? "ring-2 ring-pink-400" : ""}`}
                  style={{ left: img.x, top: img.y, width: img.w, transform: `rotate(${img.rot}deg)`, touchAction: "none" }}
                  onPointerDown={(e) => startDrag(e, "image", img.id, "move")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.src} alt="" draggable={false} className="w-full select-none rounded-xl shadow-md" />
                  {active && (
                    <span onPointerDown={(e) => startDrag(e, "image", img.id, "resize")}
                      className="absolute -bottom-2 -left-2 h-5 w-5 cursor-nwse-resize rounded-full border-2 border-pink-400 bg-white" title="Redimensionner" />
                  )}
                </div>
              );
            })}

            {/* sticky notes */}
            {notes.map((note) => {
              const active = selected?.kind === "note" && selected.id === note.id;
              return (
                <div key={note.id} className={`sticky-note absolute z-30 rounded-sm rounded-bl-3xl ${active ? "ring-2 ring-pink-400" : ""}`}
                  style={{ left: note.x, top: note.y, width: note.w, background: note.color, transform: `rotate(${note.rot}deg)`, touchAction: "none" }}
                  onPointerDown={() => setSelected({ kind: "note", id: note.id })}>
                  <div className="flex cursor-grab items-center justify-between px-2 py-1 active:cursor-grabbing"
                    onPointerDown={(e) => startDrag(e, "note", note.id, "move")}>
                    <span className="h-1 w-8 rounded-full bg-black/15" />
                    <button onClick={() => upd({ notes: notes.filter((n) => n.id !== note.id) })} className="text-black/30 hover:text-red-500" aria-label="Supprimer la note"><Trash2 size={12} /></button>
                  </div>
                  <textarea
                    value={note.text}
                    onChange={(e) => upd({ notes: notes.map((n) => (n.id === note.id ? { ...n, text: e.target.value } : n)) })}
                    dir="auto" lang="fr" spellCheck
                    placeholder="Une idée rapide…"
                    className="w-full resize-none bg-transparent px-3 pb-3 font-hand-fr text-[19px] leading-snug text-[#5b4a3b] outline-none placeholder:text-black/25"
                    rows={3}
                  />
                  {active && (
                    <span onPointerDown={(e) => startDrag(e, "note", note.id, "resize")}
                      className="absolute -bottom-2 -left-2 h-5 w-5 cursor-nwse-resize rounded-full border-2 border-pink-400 bg-white" title="Redimensionner" />
                  )}
                </div>
              );
            })}

            {/* stickers */}
            {stickers.map((s, i) => {
              const active = selected?.kind === "sticker" && selected.id === String(i);
              return (
                <span key={i}
                  onPointerDown={(e) => startDrag(e, "sticker", String(i), "move")}
                  className={`absolute z-30 cursor-grab select-none rounded-full bg-white/75 p-1 shadow active:cursor-grabbing ${active ? "ring-2 ring-pink-400" : ""}`}
                  style={{ left: `${s.x}%`, top: `${s.y}%`, transform: `translate(-50%,-50%) rotate(${s.rot}deg)`, touchAction: "none" }}>
                  <Icon name={s.icon} size={s.size} color={s.color} />
                </span>
              );
            })}

            {/* voice hearts */}
            <div className="absolute bottom-3 left-3 z-30 flex gap-1.5">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
