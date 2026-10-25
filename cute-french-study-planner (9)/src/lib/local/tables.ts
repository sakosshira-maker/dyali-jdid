// Column defaults mirror the former PostgreSQL schema so every screen keeps
// receiving exactly the same shape of data.
type TableSpec = { columns: Record<string, unknown>; required?: string[]; updatedAt?: boolean };

export const GENERIC_TABLES: Record<string, TableSpec> = {
  modules: { columns: { name: null, short: "", color: "#ffd6e8", icon: "BookOpen", teacher: "", coefficient: 1, credits: 3, description: "" }, required: ["name"] },
  timetable: { columns: { moduleId: null, day: 0, startTime: "08:00", endTime: "09:30", room: "", kind: "Cours" } },
  notebooks: { columns: { moduleId: null, title: null, coverColor: "#ffd6e8", coverIcon: "NotebookPen", kind: "Cours", coverPattern: "uni" }, required: ["title"] },
  pages: { columns: { notebookId: null, moduleId: null, title: "Page sans titre", content: "", paper: "seyes", font: "Caveat", ink: "#3b4a6b", fontSize: 21, stickers: [], sortOrder: 0, html: "", notes: [], images: [], strokes: [], orientation: "portrait", sheets: 1 }, updatedAt: true },
  stickies: { columns: { moduleId: null, text: null, color: "#fff3a6" }, required: ["text"] },
  flashcards: { columns: { moduleId: null, term: null, definition: "", example: "", known: false }, required: ["term"] },
  quiz: { columns: { moduleId: null, question: null, options: [], correctIndex: 0, explanation: "" }, required: ["question"] },
  grades: { columns: { moduleId: null, label: "Évaluation", score: 0, outOf: 20, kind: "CC", date: "" } },
  attachments: { columns: { moduleId: null, name: null, kind: "Présentation", mime: "", size: 0, dataUrl: "" }, required: ["name"] },
  voice: { columns: { moduleId: null, pageId: null, title: "Note vocale", dataUrl: "", duration: 0 } },
  stage: { columns: { title: null, category: "Observation", school: "", date: "", content: "" }, required: ["title"] },
  doubts: { columns: { moduleId: null, question: null, answer: "", resolved: false }, required: ["question"] },
  progress: { columns: { key: "main", points: 0, pomodoros: 0, data: {} } },
};

export const STUDY_TABLES = ["books", "moods", "words", "oral", "plans", "events", "badges", "focus"];
export const ALL_TABLES = [...Object.keys(GENERIC_TABLES), ...STUDY_TABLES];

// Same "on delete cascade" behaviour as the old foreign keys.
export const CASCADES: Record<string, Array<[string, string]>> = {
  modules: [["timetable", "moduleId"], ["notebooks", "moduleId"], ["pages", "moduleId"], ["stickies", "moduleId"], ["flashcards", "moduleId"], ["quiz", "moduleId"], ["grades", "moduleId"], ["attachments", "moduleId"], ["voice", "moduleId"]],
  notebooks: [["pages", "notebookId"]],
};
