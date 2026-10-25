"use client";
import React, { useEffect, useRef, useState } from "react";
import {
  Plus, Trash2, Save, Printer, ChevronRight, ChevronLeft, Heart, Mic, Square,
  Play, Pause, Sparkles, BookPlus, FilePlus2, PanelLeftClose, PanelLeftOpen, Pencil, Check,
} from "lucide-react";
import type { NotebookT, PageT, VoiceT, Sticker, ModuleT } from "@/lib/app";
import { FONTS, PAPERS, INKS, STICKERS, PASTELS, printPages } from "@/lib/app";
import { NOTEBOOK_COVERS, COVER_PATTERNS, coverStyle } from "@/lib/constants";
import { htmlToText, textToHtml } from "@/lib/page-content";
import { sfx } from "@/lib/sound";
import { Icon, Modal, CuteButton, EmptyState } from "./ui";
import PageStudio from "./notebook/PageStudio";
import FrenchTutor from "./FrenchTutor";
import SummaryFinishButton from "./SummaryFinishButton";
import { correctFrench, type Correction } from "@/lib/frenchCorrector";
import { clearDraftSnapshot, readDraftSnapshot, useAutosave, usePersistentState } from "@/lib/persistence";

type Create = (resource: string, body: Record<string, unknown>) => Promise<any>;
type Update = (resource: string, id: number, body: Record<string, unknown>) => Promise<any>;
type Remove = (resource: string, id: number) => Promise<void>;

const STICKER_COLORS = ["#ff7bac", "#f6b93b", "#9b7ede", "#4fc3a1", "#5aa9e6", "#ff8c69"];
const COVER_ICONS = ["NotebookPen", "BookOpen", "Sparkles", "Heart", "Flower2", "Cat", "Rabbit", "Star", "Feather", "GraduationCap", "Music", "Crown"];

/** Fields written to storage for a page. */
const pagePayload = (p: PageT) => ({
  title: p.title, content: p.content, paper: p.paper, font: p.font, ink: p.ink, fontSize: p.fontSize,
  stickers: p.stickers, html: p.html ?? "", notes: p.notes ?? [], images: p.images ?? [],
  strokes: p.strokes ?? [], orientation: p.orientation ?? "portrait", sheets: p.sheets ?? 1,
});

export default function NotebookEditor({
  module, notebooks, pages, voice, onCreate, onUpdate, onDelete, addPoints,
}: {
  module: ModuleT; notebooks: NotebookT[]; pages: PageT[]; voice: VoiceT[];
  onCreate: Create; onUpdate: Update; onDelete: Remove; addPoints: (n: number, reason: string) => void;
}) {
  const myNotebooks = notebooks.filter((n) => n.moduleId === module.id);
  const [nbId, setNbId] = usePersistentState<number | null>(`nb:${module.id}`, null);
  const activeNb = myNotebooks.find((n) => n.id === nbId) || myNotebooks[0];
  const nbPages = pages.filter((p) => p.notebookId === activeNb?.id).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const [pageIdx, setPageIdx] = usePersistentState<number>(`page:${module.id}`, 0);
  const page = nbPages[Math.min(pageIdx, Math.max(0, nbPages.length - 1))];

  const [draft, setDraft] = useState<PageT | null>(null);
  const [dirty, setDirty] = useState(false);
  const [coverForm, setCoverForm] = useState<null | { id?: number; title: string; kind: string; coverColor: string; coverIcon: string; coverPattern: string }>(null);
  const [liveErrors, setLiveErrors] = useState<Correction[]>([]);
  const [showLiveErrors, setShowLiveErrors] = usePersistentState(`errors-visible:${module.id}`, true);
  const [toolsOpen, setToolsOpen] = usePersistentState(`tools-open:${module.id}`, true);
  const [recovered, setRecovered] = useState(false);

  const analyzeText = (text: string) => {
    if (!text || text.trim().length < 3) { setLiveErrors([]); return; }
    setLiveErrors(correctFrench(text).corrections);
  };

  // The corrector runs once she pauses, not on every single letter.
  const analyzeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleAnalyze = (text: string) => {
    if (analyzeTimer.current) clearTimeout(analyzeTimer.current);
    analyzeTimer.current = setTimeout(() => analyzeText(text), 700);
  };
  useEffect(() => () => { if (analyzeTimer.current) clearTimeout(analyzeTimer.current); }, []);

  // `dirty` and the current draft are read through refs so that typing never
  // re-runs this effect — it must only react to a real change of page.
  const draftRef = useRef<PageT | null>(null);
  draftRef.current = draft;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!page) { setDraft(null); setRecovered(false); return; }
    // Still writing on this page? Keep her words, don't pull the stored copy.
    if (draftRef.current?.id === page.id && dirtyRef.current) return;
    const serverCopy: PageT = { ...page, stickers: [...(page.stickers || [])] };
    // Recover work typed before a refresh or an accidental close.
    const snapshot = readDraftSnapshot<PageT>(`page-${page.id}`);
    const isAhead = snapshot && typeof snapshot.content === "string" &&
      (snapshot.content !== page.content || snapshot.title !== page.title ||
        JSON.stringify(snapshot.html || "") !== JSON.stringify(page.html || "") ||
        JSON.stringify(snapshot.stickers || []) !== JSON.stringify(page.stickers || []));
    const next = isAhead ? { ...serverCopy, ...snapshot, id: page.id, notebookId: page.notebookId } : serverCopy;
    if (!next.html && next.content) next.html = textToHtml(next.content);
    setDraft(next);
    setRecovered(Boolean(isAhead));
    setDirty(Boolean(isAhead));
    analyzeText(next.content || "");
  }, [page?.id, page?.content, page?.title]); // eslint-disable-line

  // Only reset to the first page when the notebook truly changes — never on mount.
  const previousNotebook = useRef<number | null>(null);
  useEffect(() => {
    const current = activeNb?.id ?? null;
    if (previousNotebook.current === null) { previousNotebook.current = current; return; }
    if (previousNotebook.current !== current) { previousNotebook.current = current; setPageIdx(0); }
  }, [activeNb?.id]); // eslint-disable-line

  const upd = (patch: Partial<PageT>) => { setDraft((d) => (d ? { ...d, ...patch } : d)); setDirty(true); setRecovered(false); };

  const save = async () => {
    if (!draft) return;
    await onUpdate("pages", draft.id, pagePayload(draft));
    clearDraftSnapshot(`page-${draft.id}`);
    setDirty(false);
    sfx.chime();
    addPoints(10, `Page enregistrée : ${draft.title}`);
  };

  // Everything is saved automatically, including drawings, notes and images.
  // Only the written fields are compared: storage stamps `updatedAt` on each
  // save, and including it would make every save look like a fresh change.
  const pageId = draft?.id ?? 0;
  const { status: saveStatus } = useAutosave(
    draft ? `page-${draft.id}` : "no-page",
    draft ? pagePayload(draft) : null,
    async (value) => {
      if (!value || !pageId) return;
      await onUpdate("pages", pageId, value);
      clearDraftSnapshot(`page-${pageId}`);
      // Only call it saved if she hasn't written something new meanwhile.
      const current = draftRef.current;
      if (current && current.id === pageId && JSON.stringify(pagePayload(current)) === JSON.stringify(value)) setDirty(false);
    },
    1500,
    Boolean(draft),
  );

  const addPage = async () => {
    if (!activeNb) return;
    const p = await onCreate("pages", {
      notebookId: activeNb.id, moduleId: module.id, title: "Nouvelle page", content: "", html: "",
      paper: "seyes", font: "Caveat", ink: "#3b4a6b", fontSize: 21, stickers: [], sortOrder: nbPages.length,
      notes: [], images: [], strokes: [], orientation: "portrait", sheets: 1,
    });
    sfx.flip();
    setPageIdx(nbPages.length);
    return p;
  };

  const saveCover = async () => {
    if (!coverForm || !coverForm.title.trim()) return;
    const body = { title: coverForm.title, kind: coverForm.kind, coverColor: coverForm.coverColor, coverIcon: coverForm.coverIcon, coverPattern: coverForm.coverPattern };
    if (coverForm.id) {
      await onUpdate("notebooks", coverForm.id, body);
    } else {
      const nb = await onCreate("notebooks", { ...body, moduleId: module.id });
      await onCreate("pages", {
        notebookId: nb.id, moduleId: module.id, title: "Première page", content: "", html: "",
        paper: "seyes", font: "Caveat", ink: "#3b4a6b", fontSize: 21, stickers: [], sortOrder: 0,
        notes: [], images: [], strokes: [], orientation: "portrait", sheets: 1,
      });
      setNbId(nb.id);
      addPoints(5, `Nouveau cahier : ${nb.title}`);
    }
    setCoverForm(null);
    sfx.chime();
  };

  const addSticker = (icon: string) => {
    if (!draft) return;
    const st: Sticker = { icon, x: 20 + Math.random() * 55, y: 12 + Math.random() * 30, color: STICKER_COLORS[Math.floor(Math.random() * STICKER_COLORS.length)], size: 34, rot: Math.round(Math.random() * 24 - 12) };
    upd({ stickers: [...(draft.stickers || []), st] });
    sfx.stick();
  };

  const flipTo = (idx: number) => { if (idx >= 0 && idx < nbPages.length) { sfx.flip(); setPageIdx(idx); } };

  const exportPdf = (title: string, list: PageT[]) => {
    try { sfx.flip(); printPages(title, list, module.name); }
    catch (e) { window.alert(e instanceof Error ? e.message : "Impression impossible."); }
  };

  return (
    <div>
      {/* Bookshelf */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="font-display font-bold text-[#8a4b7c] flex items-center gap-1.5"><Icon name="LibraryBig" size={19} /> رفّ دفاتري · Ma bibliothèque</span>
        <CuteButton className="bg-violet-400 text-white !px-3 !py-1.5 text-xs"
          onClick={() => setCoverForm({ title: "", kind: "Cours", coverColor: NOTEBOOK_COVERS[(myNotebooks.length + 1) % NOTEBOOK_COVERS.length], coverIcon: "NotebookPen", coverPattern: "uni" })}>
          <BookPlus size={15} /> دفتر جديد
        </CuteButton>
      </div>

      {myNotebooks.length === 0 && <EmptyState icon="NotebookPen" text="لا يوجد دفتر بعد لهذه المادة" sub="أنشئي دفتراً للدروس، وآخر للملخصات، وثالثاً للتمارين — وخصّصي غلاف كل دفتر كما تحبين" />}

      <div className="flex gap-3 overflow-x-auto pb-3 pt-1 px-1">
        {myNotebooks.map((nb) => {
          const count = pages.filter((p) => p.notebookId === nb.id).length;
          const active = activeNb?.id === nb.id;
          return (
            <button key={nb.id} onClick={() => { sfx.flip(); setNbId(nb.id); }}
              className={`slot-btn shrink-0 w-32 rounded-2xl rounded-r-md border-2 p-3 text-right relative ${active ? "border-[#8a4b7c] ring-2 ring-pink-200" : "border-white"}`}
              style={coverStyle(nb.coverColor, nb.coverPattern)}>
              <span className="absolute top-0 bottom-0 right-2 w-[3px] bg-white/60 rounded" />
              <Icon name={nb.coverIcon} size={26} color="#8a4b7c" />
              <p className="font-display font-bold text-sm text-[#5b3a5e] mt-2 leading-tight line-clamp-2" dir="auto">{nb.title}</p>
              <p className="text-[11px] text-[#8a6d9e] mt-1">{nb.kind} · {count} صفحة</p>
              {active && (
                <span className="absolute top-1.5 left-1.5 flex gap-1">
                  <span role="button" aria-label="تزيين الغلاف"
                    onClick={(e) => { e.stopPropagation(); setCoverForm({ id: nb.id, title: nb.title, kind: nb.kind, coverColor: nb.coverColor, coverIcon: nb.coverIcon, coverPattern: nb.coverPattern || "uni" }); }}
                    className="bg-white/85 text-violet-500 rounded-full p-1"><Pencil size={12} /></span>
                  <span role="button" aria-label="حذف الدفتر"
                    onClick={async (e) => { e.stopPropagation(); if (confirm("Supprimer ce cahier et toutes ses pages ?")) { await onDelete("notebooks", nb.id); setNbId(null); } }}
                    className="bg-white/85 text-red-400 rounded-full p-1"><Trash2 size={12} /></span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeNb && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <CuteButton className="bg-pink-400 text-white !py-1.5 text-xs" onClick={addPage}><FilePlus2 size={15} /> صفحة جديدة</CuteButton>
          <CuteButton className="bg-emerald-300 text-emerald-800 !py-1.5 text-xs" onClick={() => exportPdf(activeNb.title, nbPages)}><Printer size={15} /> تصدير الدفتر PDF (A4)</CuteButton>
          {draft && <CuteButton className="bg-sky-200 text-sky-800 !py-1.5 text-xs" onClick={() => exportPdf(draft.title, [draft])}><Printer size={15} /> PDF لهذه الصفحة (A4)</CuteButton>}
          <CuteButton className="bg-violet-100 text-violet-600 !py-1.5 text-xs" onClick={() => { sfx.pop(); setToolsOpen((o) => !o); }}>
            {toolsOpen ? <><PanelLeftClose size={15} /> إخفاء الأدوات</> : <><PanelLeftOpen size={15} /> إظهار الأدوات</>}
          </CuteButton>
          <div className="ms-auto flex items-center gap-1 text-sm font-bold text-[#8a6d9e]">
            <button className="cute-btn bg-pink-50 p-1.5 text-pink-500" onClick={() => flipTo(pageIdx + 1)} aria-label="الصفحة السابقة"><ChevronRight size={17} /></button>
            <span dir="ltr">{nbPages.length ? pageIdx + 1 : 0} / {nbPages.length}</span>
            <button className="cute-btn bg-pink-50 p-1.5 text-pink-500" onClick={() => flipTo(pageIdx - 1)} aria-label="الصفحة التالية"><ChevronLeft size={17} /></button>
          </div>
        </div>
      )}

      {activeNb && !draft && <EmptyState icon="FilePlus2" text="هذا الدفتر فارغ" sub="اضغطي «صفحة جديدة» لبدء الكتابة" />}

      {draft && (
        <div className={`grid gap-4 ${toolsOpen ? "xl:grid-cols-[230px,1fr]" : "grid-cols-1"}`}>
          {/* Toolbar */}
          {toolsOpen && (
            <div className="cute-card p-3 space-y-4 h-fit order-2 xl:order-1">
              <div>
                <p className="text-xs font-bold text-[#8a6d9e] mb-1.5">الخط الأساسي · Police de base</p>
                <select className="field !text-xs" value={draft.font} onChange={(e) => upd({ font: e.target.value })}>
                  {FONTS.map((f) => <option key={f.value} value={f.value}>{f.name}</option>)}
                </select>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-[#b49cc4]">الحجم</span>
                  <input type="range" min={14} max={34} value={draft.fontSize} onChange={(e) => upd({ fontSize: Number(e.target.value) })} className="flex-1 accent-pink-400" />
                  <span className="text-xs font-bold">{draft.fontSize}</span>
                </div>
                <p className="text-[10.5px] text-[#b49cc4] mt-1">حدّدي كلمة أو جملة واستعملي الشريط العلوي لتغيير لونها وحجمها وخطها وحدها.</p>
              </div>

              <div>
                <p className="text-xs font-bold text-[#8a6d9e] mb-1.5">ورق الدفتر · Papier</p>
                <select className="field !text-xs" value={draft.paper} onChange={(e) => upd({ paper: e.target.value })}>
                  {PAPERS.map((p) => <option key={p.value} value={p.value}>{p.name}</option>)}
                </select>
              </div>

              <div>
                <p className="text-xs font-bold text-[#8a6d9e] mb-1.5">لون الحبر الأساسي</p>
                <div className="flex flex-wrap gap-1.5">
                  {INKS.map((ink) => (
                    <button key={ink.value} title={ink.name} onClick={() => { sfx.pop(); upd({ ink: ink.value }); }}
                      className={`w-7 h-7 rounded-full border-[3px] ${draft.ink === ink.value ? "border-[#5b3a5e] scale-110" : "border-white"} shadow`} style={{ background: ink.value }} />
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-[#8a6d9e] mb-1.5 flex items-center gap-1"><Sparkles size={13} /> ملصقاتي · Stickers</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {STICKERS.map((s) => (
                    <button key={s} onClick={() => addSticker(s)} className="bg-pink-50 hover:bg-pink-100 border border-pink-100 rounded-xl p-1.5 flex items-center justify-center transition hover:scale-110" title={s}>
                      <Icon name={s} size={18} color="#e06aa0" />
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-[#b49cc4] mt-1">اسحبي الملصق فوق الصفحة، واستعملي أزرار «العنصر المحدد» لتدويره أو حذفه.</p>
              </div>

              <VoiceRecorder pageId={draft.id} moduleId={module.id} voice={voice.filter((v) => v.pageId === draft.id)} onCreate={onCreate} onDelete={onDelete} addPoints={addPoints} />

              {/* مؤشر الأخطاء اللحظي */}
              {draft.content && draft.content.trim().length >= 3 && (
                <div className="rounded-2xl border-2 border-[#FFB3D1] bg-[#FFF0F6] p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl border-2 border-[#FFB3D1] bg-white">
                        <Icon name="MessageCircleQuestion" size={16} color="#C2255C" />
                      </span>
                      <div>
                        <p className="font-[Baloo_2] text-[12px] font-extrabold leading-none text-[#C2255C]">
                          {liveErrors.length > 0 ? `${liveErrors.length} faute${liveErrors.length > 1 ? "s" : ""} détectée${liveErrors.length > 1 ? "s" : ""}` : "Aucune faute"}
                        </p>
                        <p className="text-[10px] font-bold text-[#B0799C]">
                          {liveErrors.length > 0 ? "Corrige-les avec le professeur ci-dessous" : "Ton texte est parfait"}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => { sfx.pop(); setShowLiveErrors((s) => !s); }}
                      className={`cute-btn px-2.5 py-1 text-[10px] font-bold rounded-full ${showLiveErrors ? "bg-[#C2255C] text-white" : "bg-white text-[#C2255C] border-[#FFB3D1]"}`}
                    >
                      {showLiveErrors ? "Masquer" : "Montrer"}
                    </button>
                  </div>
                  {showLiveErrors && liveErrors.length > 0 && (
                    <div className="mt-2 max-h-32 space-y-1.5 overflow-y-auto pr-0.5">
                      {liveErrors.slice(0, 4).map((err, i) => (
                        <div key={i} className="flex items-center gap-1.5 rounded-lg bg-white/80 px-2 py-1.5 text-[10.5px] font-bold">
                          <span className="rounded bg-[#FFE3EC] px-1.5 py-0.5 text-[#C2255C] line-through decoration-[#E87BA0]">{err.wrong}</span>
                          <span className="text-[#C48AEA]">→</span>
                          <span className="rounded bg-[#E8FBEF] px-1.5 py-0.5 text-[#1B7046]">{err.right}</span>
                        </div>
                      ))}
                      {liveErrors.length > 4 && (
                        <p className="text-center text-[10px] font-bold text-[#B0799C]">+{liveErrors.length - 4} autres corrections dans le Professeur virtuel ↓</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <FrenchTutor
                getText={() => draft.content || ""}
                onDetected={(corrections) => setLiveErrors(corrections)}
                onApply={(corrected) => {
                  upd({ content: corrected, html: textToHtml(corrected) });
                  setLiveErrors([]);
                  addPoints(3, "Correction appliquée par le professeur virtuel");
                }}
              />
            </div>
          )}

          {/* Studio */}
          <div className="order-1 xl:order-2 min-w-0">
            {recovered && (
              <div className="mb-2 rounded-2xl border-2 border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-700">
                تمت استعادة كتابتك غير المحفوظة من آخر مرة. اضغطي «حفظ الصفحة» لتأكيدها.
              </div>
            )}

            <PageStudio
              draft={draft}
              upd={upd}
              onWrite={(html, text) => { upd({ html, content: text }); scheduleAnalyze(text); }}
              paperClass={`paper-${draft.paper}`}
            >
              {voice.filter((v) => v.pageId === draft.id).map((v) => <VoiceHeart key={v.id} v={v} />)}
            </PageStudio>

            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <CuteButton className={`${dirty ? "bg-pink-500" : "bg-pink-300"} text-white`} onClick={save}><Save size={16} /> {dirty ? "حفظ الصفحة · Enregistrer" : "محفوظة"}</CuteButton>
              <SummaryFinishButton key={draft.id} pageId={draft.id} content={draft.content || ""} save={save} />
              <CuteButton className="bg-red-50 text-red-400" onClick={async () => { if (confirm("Supprimer cette page ?")) { await onDelete("pages", draft.id); setPageIdx(0); } }}><Trash2 size={16} /> حذف الصفحة</CuteButton>
              <span className="text-xs font-bold inline-flex items-center gap-1.5" aria-live="polite">
                {saveStatus === "saving" && <span className="text-sky-500">جارٍ الحفظ التلقائي…</span>}
                {saveStatus === "saved" && !dirty && <span className="text-emerald-500">✓ محفوظة تلقائياً</span>}
                {saveStatus === "pending" && dirty && <span className="text-[#b49cc4]">سيُحفظ تلقائياً بعد توقف الكتابة</span>}
                {saveStatus === "error" && <span className="text-rose-500">تعذّر الحفظ — يعيد المحاولة، والنص محفوظ محلياً</span>}
              </span>
            </div>

            {/* page thumbnails */}
            <div className="flex gap-1.5 mt-3 flex-wrap">
              {nbPages.map((p, i) => (
                <button key={p.id} onClick={() => flipTo(i)} className={`cute-btn px-2.5 py-1 text-[11px] font-bold max-w-[140px] truncate ${i === pageIdx ? "bg-[#8a4b7c] text-white" : "bg-white text-[#8a6d9e] border-pink-100"}`} dir="auto">
                  {i + 1}. {p.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {coverForm && (
        <Modal title={coverForm.id ? "تزيين الغلاف · Décorer la couverture" : "دفتر جديد · Nouveau cahier"} onClose={() => setCoverForm(null)}>
          <div className="space-y-3">
            <div className="flex justify-center">
              <div className="w-28 rounded-2xl rounded-r-md border-2 border-white p-3 text-right shadow relative" style={coverStyle(coverForm.coverColor, coverForm.coverPattern)}>
                <span className="absolute top-0 bottom-0 right-2 w-[3px] bg-white/60 rounded" />
                <Icon name={coverForm.coverIcon} size={24} color="#8a4b7c" />
                <p className="font-display font-bold text-xs text-[#5b3a5e] mt-2 leading-tight line-clamp-2" dir="auto">{coverForm.title || "Mon cahier"}</p>
              </div>
            </div>
            <input className="field" placeholder="Titre du cahier — عنوان الدفتر" value={coverForm.title} onChange={(e) => setCoverForm({ ...coverForm, title: e.target.value })} dir="auto" />
            <select className="field" value={coverForm.kind} onChange={(e) => setCoverForm({ ...coverForm, kind: e.target.value })}>
              {["Cours", "Résumés", "Exercices", "Glossaire", "Autre"].map((k) => <option key={k}>{k}</option>)}
            </select>
            <div>
              <p className="text-xs font-bold text-[#8a6d9e] mb-1.5">لون الغلاف</p>
              <div className="flex flex-wrap gap-1.5">{[...new Set([...NOTEBOOK_COVERS, ...PASTELS])].map((c) => (
                <button key={c} onClick={() => setCoverForm({ ...coverForm, coverColor: c })} aria-label={`Couleur ${c}`}
                  className={`w-8 h-8 rounded-full border-[3px] ${coverForm.coverColor === c ? "border-[#5b3a5e] scale-110" : "border-white"} shadow`} style={{ background: c }} />
              ))}</div>
            </div>
            <div>
              <p className="text-xs font-bold text-[#8a6d9e] mb-1.5">نقشة الغلاف · Motif</p>
              <div className="flex flex-wrap gap-1.5">{COVER_PATTERNS.map((p: { name: string; value: string }) => (
                <button key={p.value} onClick={() => setCoverForm({ ...coverForm, coverPattern: p.value })} title={p.name}
                  className={`h-9 w-12 rounded-xl border-2 ${coverForm.coverPattern === p.value ? "border-[#8a4b7c]" : "border-white"} shadow`}
                  style={coverStyle(coverForm.coverColor, p.value)} />
              ))}</div>
            </div>
            <div>
              <p className="text-xs font-bold text-[#8a6d9e] mb-1.5">ملصق الغلاف</p>
              <div className="flex flex-wrap gap-1.5">{COVER_ICONS.map((ic) => (
                <button key={ic} onClick={() => setCoverForm({ ...coverForm, coverIcon: ic })} aria-label={ic}
                  className={`p-2 rounded-xl border-2 ${coverForm.coverIcon === ic ? "border-pink-400 bg-pink-50" : "border-pink-100 bg-white"}`}><Icon name={ic} size={19} color="#e06aa0" /></button>
              ))}</div>
            </div>
            <CuteButton className="bg-pink-500 text-white w-full justify-center" onClick={saveCover}>
              {coverForm.id ? <><Check size={16} /> حفظ الغلاف</> : <><Plus size={16} /> إنشاء الدفتر</>}
            </CuteButton>
          </div>
        </Modal>
      )}
    </div>
  );
}

function VoiceHeart({ v }: { v: VoiceT }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const toggle = () => {
    if (!audioRef.current) { audioRef.current = new Audio(v.dataUrl); audioRef.current.onended = () => setPlaying(false); }
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { void audioRef.current.play(); setPlaying(true); }
  };
  return (
    <button onClick={toggle} title={v.title} className="relative text-pink-500 hover:scale-125 transition">
      <Heart size={34} fill="#ffd6e8" />
      <span className="absolute inset-0 flex items-center justify-center text-pink-600">{playing ? <Pause size={13} /> : <Play size={13} />}</span>
    </button>
  );
}

function VoiceRecorder({ pageId, moduleId, voice, onCreate, onDelete, addPoints }: {
  pageId: number; moduleId: number; voice: VoiceT[];
  onCreate: Create; onDelete: Remove; addPoints: (n: number, r: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState("");
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const reader = new FileReader();
        reader.onload = async () => {
          await onCreate("voice", { moduleId, pageId, title: `Note vocale — ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`, dataUrl: String(reader.result), duration: secs });
          sfx.chime(); addPoints(5, "Note vocale ajoutée");
        };
        reader.readAsDataURL(blob);
      };
      recRef.current = rec;
      rec.start();
      setRecording(true); setSecs(0);
      timerRef.current = setInterval(() => setSecs((s) => s + 1), 1000);
    } catch { setError("Autorise le microphone pour enregistrer."); }
  };

  const stop = () => {
    recRef.current?.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  return (
    <div>
      <p className="text-xs font-bold text-[#8a6d9e] mb-1.5 flex items-center gap-1"><Mic size={13} /> ملاحظات صوتية · Notes vocales</p>
      <button onClick={() => (recording ? stop() : void start())}
        className={`cute-btn w-full justify-center px-3 py-2 text-xs font-bold flex items-center gap-2 ${recording ? "bg-red-400 text-white animate-pulse" : "bg-pink-100 text-pink-600"}`}>
        {recording ? <><Square size={14} /> إيقاف التسجيل… {secs}ث</> : <><Heart size={15} fill="currentColor" /> سجّلي بصوتك</>}
      </button>
      {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
      <div className="mt-2 space-y-1.5">
        {voice.map((v) => (
          <div key={v.id} className="flex items-center gap-2 bg-pink-50/70 border border-pink-100 rounded-2xl px-2 py-1.5">
            <VoiceHeart v={v} />
            <span className="text-[11px] font-bold text-[#8a6d9e] flex-1 truncate" dir="auto">{v.title}</span>
            <button className="text-red-300 hover:text-red-500" onClick={() => void onDelete("voice", v.id)} aria-label="Supprimer"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
