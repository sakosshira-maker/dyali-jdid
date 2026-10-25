// Study corners (library, dictionary, moods, oral studio, lesson plans, badges,
// focus timer, tutor) now run entirely in the browser with the same rules.
import { DAILY_WORDS, LIBRARY_STARTERS, MOODS } from "../study-catalog";
import { generateLesson } from "../lesson-generator";
import { localOralReview } from "../oral-analysis";
import { localTutorAnswer } from "../tutor-answers";
import { StudyError, audioData as audioValue, bookValues, dateKey, num, oralValues, planValues, positiveId, str } from "../study-rules";
import type { BadgeInfo, BadgeState, OralMetrics, OralReview } from "../study-types";
import { exclusive, iso, ready, type Backend, type Row } from "./store";

const desc = (rows: Row[]) => [...rows].sort((a, b) => b.id - a.id);

async function insert(b: Backend, t: string, data: Record<string, unknown>): Promise<Row> {
  const row = { ...data, id: await b.nextId(t) } as Row;
  await b.write({ put: [{ t, row }] });
  return row;
}
async function patch(b: Backend, t: string, row: Row, changes: Record<string, unknown>): Promise<Row> {
  const next = { ...row, ...changes } as Row;
  await b.write({ put: [{ t, row: next }] });
  return next;
}

async function awardStars(b: Backend, amount: number, reason: string, extraPomodoros = 0) {
  let row = (await b.all("progress")).find((r) => r.key === "main");
  if (!row) row = await insert(b, "progress", { key: "main", points: 0, pomodoros: 0, data: { history: [] }, createdAt: iso() });
  const old = (row.data || {}) as Record<string, unknown>;
  const history = Array.isArray(old.history) ? old.history.filter((s): s is string => typeof s === "string") : [];
  await patch(b, "progress", row, { points: (row.points || 0) + amount, pomodoros: (row.pomodoros || 0) + extraPomodoros, data: { ...old, history: [...history, reason].slice(-40) } });
}

async function recordActivity(b: Backend, key: string, kind: string, data: Record<string, unknown>, stars = 0, reason = "") {
  if ((await b.all("events")).some((e) => e.key === key)) return false;
  await insert(b, "events", { key, kind, data, createdAt: iso() });
  if (stars) await awardStars(b, stars, reason);
  return true;
}

async function completeSummary(b: Backend, pageId: number) {
  const page = await b.get("pages", pageId);
  if (!page) throw new StudyError("Page introuvable.", 404);
  if (String(page.content || "").trim().length < 40) throw new StudyError("Écris un résumé d'au moins 40 caractères, puis enregistre-le.");
  return recordActivity(b, `summary:${pageId}`, "summary", { pageId, title: page.title }, 10, `Résumé terminé : ${page.title}`);
}

async function seedLiterature(b: Backend) {
  if ((await b.all("events")).some((e) => e.key === "literature-starters-v1")) return;
  await insert(b, "events", { key: "literature-starters-v1", kind: "seed", data: {}, createdAt: iso() });
  const slugs = new Set((await b.all("books")).map((r) => r.slug));
  for (const book of LIBRARY_STARTERS) if (!slugs.has(book.slug)) await insert(b, "books", { ...book, createdAt: iso() });
}

/* ───────── Focus timer (same rules as before: rewards counted once) ───────── */

async function settleFocus(b: Backend, session: Row): Promise<Row> {
  const done = await patch(b, "focus", session, { status: "completed", remainingSeconds: 0, completedAt: iso(), endsAt: null });
  if (!(await b.all("events")).some((e) => e.key === `focus:${session.id}`)) {
    await insert(b, "events", { key: `focus:${session.id}`, kind: "focus", data: { minutes: session.minutes }, createdAt: iso() });
    await awardStars(b, 15, `Séance de concentration de ${session.minutes} min terminée`, 1);
  }
  return done;
}
const expired = (s: Row) => s.status === "running" && s.endsAt && Date.parse(s.endsAt) <= Date.now();

async function currentFocus(b: Backend): Promise<Row | null> {
  const sessions = await b.all("focus");
  const latest = sessions[sessions.length - 1];
  if (!latest) return null;
  return expired(latest) ? settleFocus(b, latest) : latest;
}

async function focusAction(b: Backend, body: Record<string, unknown>) {
  const existing = await currentFocus(b);
  if (body.action === "start") {
    if (existing && ["running", "paused"].includes(existing.status)) return existing;
    const minutes = num(body.minutes, "Minutes", 5, 50);
    if (![5, 10, 15, 20, 25, 30, 45, 50].includes(minutes)) throw new StudyError("Durée de concentration invalide.");
    return insert(b, "focus", { minutes, status: "running", remainingSeconds: minutes * 60, endsAt: new Date(Date.now() + minutes * 60_000).toISOString(), createdAt: iso(), completedAt: null });
  }
  if (!existing || body.id !== existing.id) throw new StudyError("Cette séance n'est plus active. Actualise le minuteur.", 409);
  if (["completed", "abandoned"].includes(existing.status)) return existing;
  if (body.action === "complete") throw new StudyError("La séance n'est pas encore terminée.", 409);
  if (body.action === "pause") {
    if (existing.status === "paused") return existing;
    const remainingSeconds = Math.max(1, Math.ceil(((existing.endsAt ? Date.parse(existing.endsAt) : Date.now()) - Date.now()) / 1000));
    return patch(b, "focus", existing, { status: "paused", remainingSeconds, endsAt: null });
  }
  if (body.action === "resume") {
    if (existing.status === "running") return existing;
    return patch(b, "focus", existing, { status: "running", endsAt: new Date(Date.now() + existing.remainingSeconds * 1000).toISOString() });
  }
  if (body.action === "abandon") return patch(b, "focus", existing, { status: "abandoned", endsAt: null });
  throw new StudyError("Action inconnue.");
}

/* ───────── Badges ───────── */

async function getBadges(b: Backend): Promise<BadgeState> {
  for (const session of await b.all("focus")) if (expired(session)) await settleFocus(b, session);
  const events = await b.all("events");
  const sessions = (await b.all("focus")).filter((s) => s.status === "completed" || s.status === "abandoned");
  const summaryCount = events.filter((e) => e.kind === "summary").length;
  const questions = events.filter((e) => e.kind === "question").length;
  let focusStreak = 0, focusBest = 0;
  for (const session of sessions) {
    if (session.status === "abandoned") focusStreak = 0;
    else if (session.minutes >= 25) { focusStreak++; focusBest = Math.max(focusBest, focusStreak); }
  }
  const specs = [
    { key: "plume", title: "Plume d'or", description: "Terminer 5 résumés différents avec le bouton « Résumé terminé » du cahier.", goal: 5, current: summaryCount, icon: "Feather", color: "#fff3c4" },
    { key: "temps", title: "Maître du Temps", description: "Achever 10 séances de 25 min ou plus sans en abandonner une. Les pauses ne coupent pas la série.", goal: 10, current: focusBest, icon: "Timer", color: "#e3dcff" },
    { key: "curieuse", title: "Toujours Curieuse", description: "Poser plus de 20 questions au professeur. Les vérifications automatiques ne sont pas comptées.", goal: 21, current: questions, icon: "MessageCircleQuestion", color: "#ffd6e8" },
  ];
  const dates = new Map((await b.all("badges")).map((r) => [String(r.key), String(r.unlockedAt)]));
  for (const spec of specs) {
    if (spec.current >= spec.goal && !dates.has(spec.key)) {
      const row = await insert(b, "badges", { key: spec.key, unlockedAt: iso() });
      dates.set(spec.key, row.unlockedAt);
    }
  }
  const badges: BadgeInfo[] = specs.map((s) => ({ ...s, unlockedAt: dates.get(s.key) || null }));
  return { badges, summaryCount, questions, focusStreak, focusBest };
}

/* ───────── Optional AI helpers (only used when configured on the server) ───────── */

async function audioAIAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/study/oral-review", { cache: "no-store" });
    return res.ok ? Boolean((await res.json()).audioAI) : false;
  } catch { return false; }
}

async function askTutor(body: Record<string, unknown>) {
  const question = str(body.question, "Question", 2000, true), requestId = str(body.requestId, "Requête", 100, true);
  const key = `question:${requestId}`;
  const previous = await exclusive(async (b) => (await b.all("events")).find((e) => e.key === key));
  if (previous) return previous.data;
  let result = localTutorAnswer(question);
  try {
    const res = await fetch("/api/study/tutor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }), signal: AbortSignal.timeout(25000) });
    if (res.ok) {
      const json = await res.json();
      if (typeof json.answer === "string" && json.answer.trim()) result = { answer: json.answer, source: String(json.source || result.source) };
    }
  } catch { /* the local teaching references stay available offline */ }
  const data = { question, answer: result.answer, source: result.source };
  return exclusive(async (b) => {
    const duplicate = (await b.all("events")).find((e) => e.key === key);
    if (duplicate) return duplicate.data;
    await insert(b, "events", { key, kind: "question", data, createdAt: iso() });
    return data;
  });
}

async function reviewOral(body: Record<string, unknown>): Promise<OralReview> {
  const id = num(body.id, "Enregistrement", 1, Number.MAX_SAFE_INTEGER);
  const b = await ready();
  const session = await b.get("oral", id);
  if (!session) throw new StudyError("Enregistrement introuvable.", 404);
  let review: OralReview = localOralReview(session.metrics as OralMetrics, String(session.transcript || ""));
  if (body.listen === true) {
    if (!(await audioAIAvailable())) throw new StudyError("L'écoute IA n'est pas configurée. Les mesures locales et la réécoute restent disponibles.", 503);
    const res = await fetch("/api/study/oral-review", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: session.title, kind: session.kind, reference: session.reference, transcript: session.transcript, audioData: session.audioData, metrics: session.metrics }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new StudyError(json.error || "Le service d'écoute est indisponible. Tu peux utiliser le bilan local et réessayer plus tard.", res.status);
    review = json as OralReview;
  }
  return exclusive(async (wb) => {
    const fresh = await wb.get("oral", id);
    if (!fresh) throw new StudyError("Enregistrement introuvable.", 404);
    await patch(wb, "oral", fresh, { review, ...(review.source === "audio-ai" ? { transcript: review.transcript } : {}) });
    return review;
  });
}

/* ───────── Router: same resources and messages as the former /api/study ───────── */

export async function localStudy<T>(resource: string, method = "GET", data?: unknown): Promise<T> {
  const [name, rawId] = resource.split("?")[0].split("/");
  const body = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;

  if (name === "oral-review" && method === "GET") return { audioAI: await audioAIAvailable() } as T;
  if (name === "oral-review" && method === "POST") return (await reviewOral(body)) as T;
  if (name === "tutor" && method === "POST") return (await askTutor(body)) as T;

  return exclusive(async (b): Promise<T> => {
    if (method === "GET") {
      switch (name) {
        case "badges": return (await getBadges(b)) as T;
        case "activity": return { summaries: (await b.all("events")).filter((e) => e.kind === "summary").map((e) => (e.data as { pageId: number }).pageId) } as T;
        case "books": await seedLiterature(b); return desc(await b.all("books")) as T;
        case "words": return desc(await b.all("words")) as T;
        case "plans": return (await b.all("plans")).sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt))) as T;
        case "oral": return desc(await b.all("oral")) as T;
        case "moods": return (await b.all("moods")).sort((x, y) => String(y.date).localeCompare(String(x.date))) as T;
        case "focus": return { session: await currentFocus(b), serverNow: Date.now() } as T;
        case "tutor": return desc((await b.all("events")).filter((e) => e.kind === "question")).slice(0, 12).map((e) => ({ id: e.id, data: e.data, createdAt: e.createdAt })) as T;
      }
      throw new StudyError("Espace introuvable.", 404);
    }

    if (method === "POST") {
      switch (name) {
        case "books": return (await insert(b, "books", { slug: null, ...bookValues(body), createdAt: iso() })) as T;
        case "words": {
          const word = DAILY_WORDS.find((w) => w.slug === body.slug);
          if (!word) throw new StudyError("Mot introuvable.", 404);
          const existing = (await b.all("words")).find((w) => w.slug === word.slug);
          return (existing || (await insert(b, "words", { ...word, mastered: false, createdAt: iso() }))) as T;
        }
        case "moods": {
          const date = dateKey(body.date);
          if (!MOODS.some((m) => m.key === body.mood)) throw new StudyError("Choisis un des quatre ressentis.");
          const values: Record<string, unknown> = { mood: String(body.mood), updatedAt: iso() };
          if (body.note !== undefined) values.note = str(body.note, "Note", 10000);
          if (body.audioData !== undefined) { values.audioData = audioValue(body.audioData); values.duration = num(body.duration ?? 0, "Durée", 0, 182); }
          const existing = (await b.all("moods")).find((m) => m.date === date);
          return (existing ? await patch(b, "moods", existing, values) : await insert(b, "moods", { date, note: "", audioData: "", duration: 0, ...values })) as T;
        }
        case "oral": return (await insert(b, "oral", { ...oralValues(body), review: null, createdAt: iso() })) as T;
        case "plans": { const at = iso(); return (await insert(b, "plans", { ...planValues(body), createdAt: at, updatedAt: at })) as T; }
        case "activity": {
          let recorded = false;
          if (body.kind === "summary") recorded = await completeSummary(b, num(body.pageId, "Page", 1, Number.MAX_SAFE_INTEGER));
          else if (body.kind === "points") {
            const amount = num(body.amount, "Étoiles", 1, 20);
            if (!Number.isInteger(amount)) throw new StudyError("Nombre d'étoiles invalide.");
            recorded = await recordActivity(b, `points:${str(body.requestId, "Requête", 100, true)}`, "points", {}, amount, str(body.reason, "Activité", 500, true));
          } else throw new StudyError("Activité inconnue.");
          return { recorded, ...(await getBadges(b)) } as T;
        }
        case "generate-plan": {
          const title = str(body.title, "Titre du cours", 250, true), level = str(body.level, "Niveau", 120, true), kind = str(body.kind, "Domaine", 80, true);
          const duration = num(body.duration, "Durée", 15, 180);
          if (!Number.isInteger(duration)) throw new StudyError("La durée doit être entière.");
          if (!["Langue & grammaire", "Lecture analytique", "Expression orale", "Production écrite"].includes(kind)) throw new StudyError("Domaine invalide.");
          return { draft: generateLesson(title, level, kind, duration, str(body.support ?? "", "Support", 6000)), source: "Trame pédagogique guidée, à adapter au programme et aux besoins de la classe." } as T;
        }
        case "focus": return { session: await focusAction(b, body), serverNow: Date.now() } as T;
      }
      throw new StudyError("Espace introuvable.", 404);
    }

    const id = positiveId(rawId || "");
    const tables: Record<string, string> = { books: "books", moods: "moods", words: "words", oral: "oral", plans: "plans" };
    const table = tables[name];
    if (!table) throw new StudyError("Espace introuvable.", 404);
    if (method === "DELETE") { await b.write({ del: [{ t: table, id }] }); return { ok: true } as T; }
    if (method === "PATCH") {
      let changes: Record<string, unknown>;
      if (name === "books") { changes = bookValues(body, true); if (!Object.keys(changes).length) throw new StudyError("Aucune modification."); }
      else if (name === "words") { if (typeof body.mastered !== "boolean") throw new StudyError("Valeur invalide."); changes = { mastered: body.mastered }; }
      else if (name === "plans") changes = { ...planValues(body), updatedAt: iso() };
      else if (name === "oral") changes = { transcript: str(body.transcript, "Transcription", 12000), review: null };
      else throw new StudyError("Espace introuvable.", 404);
      const row = await b.get(table, id);
      if (!row) throw new StudyError("Élément introuvable.", 404);
      return (await patch(b, table, row, changes)) as T;
    }
    throw new StudyError("Action inconnue.");
  });
}

