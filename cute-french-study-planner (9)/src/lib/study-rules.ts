// Pure validation rules shared by the browser store and the server routes.
// No database or Node-only APIs here, so this file is safe in client bundles.
import type { LessonPhase, OralMetrics } from "./study-types";

export class StudyError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function str(value: unknown, name: string, max = 10000, required = false): string {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new StudyError(`${name} : texte ${required ? "requis, " : ""}${max} caractères maximum.`);
  return value;
}
export function num(value: unknown, name: string, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new StudyError(`${name} doit être compris entre ${min} et ${max}.`);
  return value;
}
export function audioData(value: unknown) {
  const data = str(value, "Audio", 8_200_000);
  if (data && !/^data:audio\/(?:wav|x-wav|webm|ogg|mp4|mpeg)(?:;codecs=[\w.-]+)?;base64,[A-Za-z0-9+/=]+$/.test(data)) throw new StudyError("Format audio non pris en charge.");
  return data;
}
export function dateKey(value: unknown) {
  const date = str(value, "Date", 10, true);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new StudyError("Date invalide.");
  return date;
}
export function positiveId(value: string) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new StudyError("Identifiant invalide.");
  return id;
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bookValues(b: Record<string, unknown>, partial = false) {
  const result: Record<string, any> = {};
  for (const key of ["title", "author", "year", "genre", "characters", "narrative", "timeline", "notes", "sourceUrl", "color", "status"]) {
    if (partial && b[key] === undefined) continue;
    result[key] = str(b[key] ?? (key === "color" ? "#e3dcff" : key === "status" ? "À lire" : ""), key, ["title", "author", "genre"].includes(key) ? 250 : key === "year" ? 30 : 16000, key === "title");
  }
  if (result.color && !/^#[a-f\d]{6}$/i.test(result.color)) throw new StudyError("Choisis une couleur hexadécimale.");
  if (result.status && !["À lire", "En cours", "Lu"].includes(result.status)) throw new StudyError("Statut de lecture invalide.");
  if (result.sourceUrl) { try { const url = new URL(result.sourceUrl); if (!/^https?:$/.test(url.protocol)) throw new Error(); } catch { throw new StudyError("Le lien doit commencer par https:// ou http://."); } }
  if (!partial || b.quotes !== undefined) {
    const quotes = b.quotes ?? [];
    if (!Array.isArray(quotes) || quotes.length > 30) throw new StudyError("30 citations maximum par livre.");
    result.quotes = quotes.map((q) => {
      if (!q || typeof q !== "object") throw new StudyError("Citation invalide.");
      return { text: str(q.text, "Citation", 4000, true), reference: str(q.reference ?? "", "Référence", 500) };
    });
  }
  return result;
}

export function metricsValues(value: unknown): OralMetrics {
  if (!value || typeof value !== "object") throw new StudyError("Mesures audio manquantes.");
  const m = value as Record<string, unknown>;
  return { duration: num(m.duration, "Durée", 1, 182), silencePercent: num(m.silencePercent, "Silence", 0, 100), longPauses: num(m.longPauses, "Pauses", 0, 500), rmsDb: num(m.rmsDb, "Volume", -120, 0), clippedPercent: num(m.clippedPercent, "Saturation", 0, 100) };
}

export function oralValues(b: Record<string, unknown>) {
  const metrics = metricsValues(b.metrics);
  const audio = audioData(b.audioData);
  if (!audio.startsWith("data:audio/wav;base64,")) throw new StudyError("Enregistre un extrait WAV avec le microphone.");
  const bytes = decodeBase64(audio.slice(audio.indexOf(",") + 1));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  if (bytes.length < 44 || ascii(0) !== "RIFF" || ascii(8) !== "WAVE" || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 16000 || view.getUint16(34, true) !== 16 || ascii(36) !== "data") throw new StudyError("L'audio doit être un enregistrement WAV mono 16 kHz du studio.");
  const duration = (bytes.length - 44) / 32000;
  if (duration < 1 || duration > 181 || Math.abs(duration - metrics.duration) > 0.6) throw new StudyError("La durée audio ne correspond pas aux mesures.");
  return { title: str(b.title, "Titre", 250, true), kind: str(b.kind ?? "Explication", "Activité", 50), reference: str(b.reference ?? "", "Texte de référence", 12000), transcript: str(b.transcript ?? "", "Transcription", 12000), audioData: audio, duration: metrics.duration, metrics };
}

export function planValues(b: Record<string, unknown>) {
  const title = str(b.title, "Titre", 250, true), level = str(b.level, "Niveau", 120, true);
  const duration = num(b.duration, "Durée", 15, 180);
  if (!Number.isInteger(duration)) throw new StudyError("Indique une durée entière en minutes.");
  if (!Array.isArray(b.phases) || b.phases.length < 3 || b.phases.length > 10) throw new StudyError("Prévois entre 3 et 10 phases.");
  const phases: LessonPhase[] = b.phases.map((p) => ({ name: str(p.name, "Phase", 200, true), minutes: num(p.minutes, "Minutes de phase", 1, 180), teacher: str(p.teacher, "Activité de l'enseignante", 6000), learners: str(p.learners, "Activité des élèves", 6000), evidence: str(p.evidence ?? "", "Trace", 4000) }));
  if (phases.reduce((sum, p) => sum + p.minutes, 0) !== duration) throw new StudyError("La somme des durées des phases doit correspondre à la durée de la séance.");
  return { title, level, duration, kind: str(b.kind, "Type", 80, true), support: str(b.support ?? "", "Support", 6000), objectives: str(b.objectives, "Objectifs", 8000, true), prerequisites: str(b.prerequisites ?? "", "Prérequis", 6000), materials: str(b.materials ?? "", "Matériel", 6000), assessment: str(b.assessment ?? "", "Évaluation", 6000), differentiation: str(b.differentiation ?? "", "Différenciation", 6000), phases };
}
