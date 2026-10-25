"use client";
import { useMemo, useState } from "react";
import { Plus, Clock, Pencil, Trash2, X, Check, Coffee, Sparkles, AlertTriangle, BookPlus, ListChecks } from "lucide-react";
import type { Module, Slot } from "@/lib/api";
import { apiCreate, apiDelete, apiUpdate } from "@/lib/api";
import { DAYS, getColor } from "@/lib/constants";
import { PASTELS } from "@/lib/app";
import { sfx } from "@/lib/sound";
import { DynIcon } from "@/components/Icon";

type TimetableProps = {
  modules: Module[];
  slots: Slot[];
  onChanged: () => void;
  onOpenModule?: (id: number) => void;
};

const START_HOUR = 8;
const END_HOUR = 19;
const TOTAL_MIN = (END_HOUR - START_HOUR) * 60;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
const KINDS = ["Cours", "TD", "TP", "Examen"];
// Same blocks as the ENS timetable, one click each.
const BLOCKS = [
  { start: "08:30", end: "11:30" },
  { start: "11:30", end: "14:30" },
  { start: "14:30", end: "17:30" },
];
const DURATIONS = [
  { label: "1 h", minutes: 60 },
  { label: "1 h 30", minutes: 90 },
  { label: "2 h", minutes: 120 },
  { label: "3 h", minutes: 180 },
  { label: "4 h", minutes: 240 },
];

function toMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function fromMinutes(total: number) {
  const m = Math.max(0, Math.min(23 * 60 + 59, total));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

type Draft = {
  id?: number;
  mode: "existing" | "new";
  moduleId: number;
  newName: string;
  newTeacher: string;
  newColor: string;
  days: number[];
  start: string;
  end: string;
  room: string;
  kind: string;
};

export default function Timetable({ modules, slots, onChanged, onOpenModule }: TimetableProps) {
  const [form, setForm] = useState<Draft | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const moduleById = useMemo(() => new Map(modules.map((m) => [m.id, m])), [modules]);
  const byDay = useMemo(() => {
    const map = new Map<number, Slot[]>();
    DAYS.forEach((d) => map.set(d.key, []));
    slots.forEach((s) => {
      const arr = map.get(Number(s.day));
      if (arr) arr.push(s);
    });
    return map;
  }, [slots]);

  const blank = (day: number, start: string, end: string): Draft => ({
    mode: modules.length ? "existing" : "new",
    moduleId: modules[0]?.id ?? 0,
    newName: "",
    newTeacher: "",
    newColor: PASTELS[modules.length % PASTELS.length],
    days: [day],
    start,
    end,
    room: "",
    kind: "Cours",
  });

  const openNew = (day: number, hour?: number) => {
    setError("");
    if (hour === undefined) setForm(blank(day, "08:30", "11:30"));
    else setForm(blank(day, fromMinutes(hour * 60), fromMinutes(Math.min((hour + 1) * 60, END_HOUR * 60))));
  };

  const openEdit = (s: Slot) => {
    setError("");
    setForm({ ...blank(Number(s.day), s.startTime, s.endTime), id: s.id, mode: "existing", moduleId: s.moduleId, room: s.room || "", kind: s.kind || "Cours" });
  };

  const today = new Date().getDay();
  const defaultDay = today >= 1 && today <= 6 ? today : 1;

  const update = (changes: Partial<Draft>) => { setForm((f) => (f ? { ...f, ...changes } : f)); setError(""); };

  const toggleDay = (day: number) => {
    if (!form) return;
    if (form.id) { update({ days: [day] }); return; }
    const days = form.days.includes(day) ? form.days.filter((d) => d !== day) : [...form.days, day].sort();
    update({ days });
  };

  const overlaps = form
    ? slots.filter((s) => s.id !== form.id && form.days.includes(Number(s.day)) && toMinutes(s.startTime) < toMinutes(form.end) && toMinutes(form.start) < toMinutes(s.endTime))
    : [];

  const save = async () => {
    if (!form || saving) return;
    if (!form.start || !form.end || toMinutes(form.end) <= toMinutes(form.start)) { setError("L'heure de fin doit être après l'heure de début."); return; }
    if (!form.days.length) { setError("Choisis au moins un jour."); return; }
    if (form.mode === "new" && !form.newName.trim()) { setError("Écris le nom de ta nouvelle matière."); return; }
    if (form.mode === "existing" && !moduleById.has(form.moduleId)) { setError("Choisis une matière."); return; }
    setSaving(true);
    try {
      let moduleId = form.moduleId;
      if (form.mode === "new") {
        const name = form.newName.trim();
        const created = await apiCreate<Module>("modules", { name, short: "", teacher: form.newTeacher.trim(), color: form.newColor, icon: "BookOpen", coefficient: 1, credits: 3, description: "" });
        moduleId = created.id;
        // Every subject gets its own notebook straight away.
        await apiCreate("notebooks", { moduleId, title: `Cahier de ${name}`, coverColor: form.newColor, coverIcon: "NotebookPen", kind: "Cours" });
      }
      const base = { moduleId, startTime: form.start, endTime: form.end, room: form.room.trim(), kind: form.kind };
      if (form.id) await apiUpdate("timetable", form.id, { ...base, day: form.days[0] });
      else for (const day of form.days) await apiCreate("timetable", { ...base, day });
      sfx.chime();
      setForm(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!form?.id) return;
    if (!window.confirm("Supprimer cette séance de l'emploi du temps ?")) return;
    try {
      await apiDelete("timetable", form.id);
      setForm(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible.");
    }
  };

  const durationLabel = form ? Math.max(0, toMinutes(form.end) - toMinutes(form.start)) : 0;

  return (
    <section className="relative">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-[Baloo_2] text-xl font-bold text-[#5B4A6F] flex items-center gap-2">
          <Clock size={18} color="#D6336C" /> Mon emploi du temps
        </h2>
        <div className="flex items-center gap-2">
          <p className="hidden sm:block text-[11px] font-bold text-[#B79CED]">
            Clique sur une matière pour ouvrir son cahier • clique sur une case libre pour ajouter une séance
          </p>
          <button
            onClick={() => openNew(defaultDay)}
            className="btn-cute flex items-center gap-1 rounded-full bg-gradient-to-l from-[#FF8FB8] to-[#B79CED] px-3 py-1.5 text-xs font-[Baloo_2] font-bold text-white shadow"
          >
            <Plus size={14} strokeWidth={3} /> Séance
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border-2 border-[#F3D9FF] bg-white/90 shadow-sm">
        <div className="min-w-[900px]">
          {/* Hours header */}
          <div className="flex border-b-2 border-[#F3D9FF] bg-[#FFF7FB]">
            <div className="w-[104px] shrink-0 border-r-2 border-[#F3D9FF] px-2 py-2 text-center text-[10px] font-extrabold text-[#B79CED]">
              Jour / Heure
            </div>
            <div className="flex flex-1">
              {HOURS.map((h) => (
                <div key={h} className="flex-1 border-r border-[#F3D9FF] px-1 py-2 text-center text-[10px] font-extrabold text-[#D6336C] last:border-r-0" dir="ltr">
                  {String(h).padStart(2, "0")}:00
                  <span className="block text-[9px] font-bold text-[#C4A8D4]">
                    {String(h + 1).padStart(2, "0")}:00
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Day rows */}
          {DAYS.map((d) => {
            const daySlots = byDay.get(d.key) ?? [];
            return (
              <div key={d.key} className="flex border-b border-[#F3E3EF] last:border-b-0 hover:bg-[#FFF0F6]/40 transition">
                <div className="w-[104px] shrink-0 border-r-2 border-[#F3D9FF] bg-[#FFF7FB]/80 px-2 py-3">
                  <p className="font-[Baloo_2] text-[12px] font-extrabold text-[#8A4B7C]">{d.label}</p>
                  <p className="text-[9px] font-bold text-[#C4A8D4]">{daySlots.length} séance{daySlots.length > 1 ? "s" : ""}</p>
                </div>
                <div className="relative flex-1" style={{ minHeight: 62 }}>
                  {/* hour background cells */}
                  <div className="absolute inset-0 flex">
                    {HOURS.map((h) => (
                      <button
                        key={h}
                        onClick={() => openNew(d.key, h)}
                        className="group flex-1 border-r border-[#F7ECF3] last:border-r-0 flex items-center justify-center"
                        aria-label={`Ajouter une séance ${d.label} ${h}:00`}
                      >
                        <Plus size={13} className="text-[#E8CFE8] opacity-0 group-hover:opacity-100 transition" />
                      </button>
                    ))}
                  </div>

                  {/* slot blocks */}
                  <div className="absolute inset-0 pointer-events-none">
                    {daySlots.map((s) => {
                      const m = moduleById.get(s.moduleId);
                      if (!m) return null;
                      const start = Math.max(toMinutes(s.startTime), START_HOUR * 60);
                      const end = Math.min(toMinutes(s.endTime), END_HOUR * 60);
                      if (end <= start) return null;
                      const left = ((start - START_HOUR * 60) / TOTAL_MIN) * 100;
                      const width = ((end - start) / TOTAL_MIN) * 100;
                      const c = getColor(m.color);
                      const active = hovered === s.id;
                      return (
                        <div
                          key={s.id}
                          className="absolute top-1.5 bottom-1.5 px-0.5 pointer-events-auto"
                          style={{ left: `${left}%`, width: `${width}%` }}
                          onMouseEnter={() => setHovered(s.id)}
                          onMouseLeave={() => setHovered(null)}
                        >
                          <button
                            onClick={() => onOpenModule?.(m.id)}
                            className="slot-btn group h-full w-full rounded-xl border-2 px-1.5 py-1 text-right overflow-hidden relative"
                            style={{ background: `linear-gradient(140deg, ${c.solid}, ${c.bg})`, borderColor: c.border }}
                            title={`${m.name} · ${s.startTime}–${s.endTime}`}
                          >
                            <span className="flex items-center gap-1">
                              <DynIcon name={m.icon} size={12} color="#fff" />
                              <span className="truncate text-[10.5px] font-extrabold leading-tight" style={{ color: c.text }} dir="auto">
                                {m.name}
                              </span>
                            </span>
                            <span className="flex items-center justify-between gap-1 text-[9px] font-bold leading-tight" style={{ color: c.text }} dir="ltr">
                              <span>{s.startTime}–{s.endTime}</span>
                              {s.room ? <span className="truncate opacity-80">{s.room}</span> : null}
                            </span>
                            <span className="absolute top-0.5 left-0.5 rounded-full bg-white/80 px-1 text-[8px] font-extrabold" style={{ color: c.text }}>
                              {s.kind}
                            </span>
                            {active && (
                              <span
                                role="button"
                                aria-label="Modifier la séance"
                                onClick={(e) => { e.stopPropagation(); openEdit(s); }}
                                className="absolute bottom-0.5 right-0.5 rounded-full bg-white/95 p-1 shadow"
                              >
                                <Pencil size={10} color="#8a6d9e" />
                              </span>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[10.5px] font-bold text-[#8A7BA6]">
        <span dir="ltr">Lundi → Samedi · 08:00 → 19:00</span>
        <span className="flex items-center gap-1">
          <Coffee size={12} /> Une séance peut durer plusieurs heures : clique dessus puis choisis ses horaires (ex. 08:00 → 12:00)
        </span>
      </div>

      {/* add / edit modal */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#5b3a5e]/40 p-3 backdrop-blur-sm" onClick={() => !saving && setForm(null)}>
          <div className="cute-card w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 relative" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={form.id ? "Modifier la séance" : "Nouvelle séance"}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-[Baloo_2] text-lg font-bold text-[#8A4B7C] flex items-center gap-2">
                <Sparkles size={18} className="text-pink-400" /> {form.id ? "Modifier la séance" : "Nouvelle séance"}
              </h3>
              <button onClick={() => setForm(null)} className="rounded-full bg-pink-100 p-1.5 text-pink-500" aria-label="Fermer"><X size={16} /></button>
            </div>

            <div className="space-y-4">
              {/* 1. Subject */}
              <section>
                <p className="mb-1.5 text-[11px] font-extrabold text-[#8A7BA6]">1 · La matière</p>
                <div className="mb-2 grid grid-cols-2 gap-1 rounded-full border-2 border-[#F6DCE9] bg-white p-1">
                  <button
                    type="button"
                    disabled={!modules.length}
                    onClick={() => update({ mode: "existing" })}
                    className={`rounded-full py-1.5 text-xs font-bold transition disabled:opacity-40 ${form.mode === "existing" ? "bg-[#8A4B7C] text-white" : "text-[#8A7BA6]"}`}
                  >
                    <ListChecks size={13} className="inline -mt-0.5" /> Mes matières
                  </button>
                  <button
                    type="button"
                    onClick={() => update({ mode: "new" })}
                    className={`rounded-full py-1.5 text-xs font-bold transition ${form.mode === "new" ? "bg-[#8A4B7C] text-white" : "text-[#8A7BA6]"}`}
                  >
                    <BookPlus size={13} className="inline -mt-0.5" /> Nouvelle matière
                  </button>
                </div>

                {form.mode === "existing" ? (
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Matière">
                    {modules.map((m) => {
                      const c = getColor(m.color);
                      const selected = form.moduleId === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => update({ moduleId: m.id })}
                          className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-[11px] font-extrabold transition ${selected ? "scale-[1.03] shadow" : "opacity-75 hover:opacity-100"}`}
                          style={{ background: c.bg, borderColor: selected ? c.text : c.border, color: c.text }}
                        >
                          <DynIcon name={m.icon} size={12} color={c.text} />
                          <span dir="auto">{m.name}</span>
                          {selected && <Check size={12} />}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-2 rounded-2xl border-2 border-dashed border-[#F6DCE9] bg-[#FFFBFE] p-3">
                    <input
                      autoFocus
                      className="field"
                      value={form.newName}
                      onChange={(e) => update({ newName: e.target.value })}
                      placeholder="Nom de la matière — ex. Les Grands Mythes"
                      aria-label="Nom de la nouvelle matière"
                      dir="auto"
                    />
                    <input
                      className="field"
                      value={form.newTeacher}
                      onChange={(e) => update({ newTeacher: e.target.value })}
                      placeholder="Enseignant(e) — facultatif"
                      aria-label="Enseignant de la nouvelle matière"
                      dir="auto"
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-bold text-[#B79CED]">Couleur</span>
                      {PASTELS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-label={`Couleur ${c}`}
                          onClick={() => update({ newColor: c })}
                          className={`h-6 w-6 rounded-full border-[3px] shadow-sm ${form.newColor === c ? "border-[#8A4B7C] scale-110" : "border-white"}`}
                          style={{ background: c }}
                        />
                      ))}
                    </div>
                    <p className="text-[10px] font-bold text-[#B79CED]">Elle apparaîtra aussi dans « Mes matières », avec son propre cahier.</p>
                  </div>
                )}
              </section>

              {/* 2. Days */}
              <section>
                <p className="mb-1.5 text-[11px] font-extrabold text-[#8A7BA6]">
                  2 · {form.id ? "Le jour" : "Le(s) jour(s)"} {!form.id && <span className="font-bold text-[#C4A8D4]">— plusieurs possibles</span>}
                </p>
                <div className="grid grid-cols-6 gap-1.5">
                  {DAYS.map((d) => {
                    const on = form.days.includes(d.key);
                    return (
                      <button
                        key={d.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleDay(d.key)}
                        className={`rounded-xl border-2 py-2 text-[11px] font-extrabold transition ${on ? "border-[#FF8FB8] bg-[#FFF0F6] text-[#C2255C]" : "border-[#F3E3EF] bg-white text-[#B79CED]"}`}
                      >
                        {d.short}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* 3. Time */}
              <section>
                <p className="mb-1.5 text-[11px] font-extrabold text-[#8A7BA6]">3 · L'horaire</p>
                <div className="mb-2 grid grid-cols-3 gap-1.5">
                  {BLOCKS.map((b) => {
                    const on = form.start === b.start && form.end === b.end;
                    return (
                      <button
                        key={b.start}
                        type="button"
                        aria-pressed={on}
                        onClick={() => update({ start: b.start, end: b.end })}
                        className={`rounded-xl border-2 py-2 text-[11px] font-extrabold transition ${on ? "border-[#B79CED] bg-[#F4F0FF] text-[#6741A8]" : "border-[#F3E3EF] bg-white text-[#8A7BA6]"}`}
                        dir="ltr"
                      >
                        {b.start} – {b.end}
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] font-bold text-[#8A7BA6]">Début
                    <input type="time" className="field mt-1" value={form.start} onChange={(e) => update({ start: e.target.value })} />
                  </label>
                  <label className="text-[11px] font-bold text-[#8A7BA6]">Fin
                    <input type="time" className="field mt-1" value={form.end} onChange={(e) => update({ end: e.target.value })} />
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold text-[#B79CED]">Durée :</span>
                  {DURATIONS.map((d) => {
                    const on = durationLabel === d.minutes;
                    return (
                      <button
                        key={d.minutes}
                        type="button"
                        aria-pressed={on}
                        onClick={() => update({ end: fromMinutes(toMinutes(form.start) + d.minutes) })}
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-extrabold ${on ? "border-[#FF8FB8] bg-[#FF8FB8] text-white" : "border-[#F3E3EF] bg-white text-[#8A7BA6]"}`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* 4. Details */}
              <section className="grid grid-cols-2 gap-2">
                <label className="text-[11px] font-bold text-[#8A7BA6]">Type
                  <select className="field mt-1" value={form.kind} onChange={(e) => update({ kind: e.target.value })}>
                    {KINDS.map((k) => <option key={k}>{k}</option>)}
                  </select>
                </label>
                <label className="text-[11px] font-bold text-[#8A7BA6]">Salle (facultatif)
                  <input className="field mt-1" value={form.room} onChange={(e) => update({ room: e.target.value })} placeholder="Salle R, Amphi A…" />
                </label>
              </section>

              {overlaps.length > 0 && (
                <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[10.5px] font-bold text-amber-700">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  Ce créneau chevauche déjà {overlaps.length > 1 ? `${overlaps.length} séances` : "une séance"} ({overlaps.map((s) => `${DAYS.find((d) => d.key === Number(s.day))?.short} ${s.startTime}–${s.endTime}`).join(", ")}). Tu peux quand même l'ajouter.
                </p>
              )}
              {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-600">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button onClick={save} disabled={saving} className="btn-cute flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#D6336C] py-2.5 font-[Baloo_2] text-sm font-bold text-white disabled:opacity-60">
                  <Check size={15} />
                  {saving ? "Enregistrement…" : form.id ? "Enregistrer" : form.days.length > 1 ? `Ajouter sur ${form.days.length} jours` : "Ajouter au tableau"}
                </button>
                {form.id && (
                  <button onClick={remove} className="btn-cute flex items-center justify-center gap-1.5 rounded-full bg-red-50 px-3 py-2 font-[Baloo_2] text-sm font-bold text-red-500">
                    <Trash2 size={15} /> Supprimer
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
