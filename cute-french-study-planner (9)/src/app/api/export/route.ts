import { db } from "@/db";
import * as s from "@/db/schema";

export const dynamic = "force-dynamic";

// One-time bridge: lets a browser copy notes written before the switch to
// browser storage. Without a database (e.g. on Netlify) it simply says so.
export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ available: false });
  try {
    const [modules, timetable, notebooks, pages, stickies, flashcards, quiz, grades, attachments, voice, stage, doubts, progress, books, moods, words, oral, plans, events, badges, focus] = await Promise.all([
      db.select().from(s.modules), db.select().from(s.timetableSlots), db.select().from(s.notebooks), db.select().from(s.pages),
      db.select().from(s.stickyNotes), db.select().from(s.flashcards), db.select().from(s.quizQuestions), db.select().from(s.grades),
      db.select().from(s.attachments), db.select().from(s.voiceNotes), db.select().from(s.stageEntries), db.select().from(s.doubts),
      db.select().from(s.progress), db.select().from(s.literaryBooks), db.select().from(s.moodEntries), db.select().from(s.savedWords),
      db.select().from(s.oralSessions), db.select().from(s.lessonPlans), db.select().from(s.studyEvents), db.select().from(s.unlockedBadges),
      db.select().from(s.focusSessions),
    ]);
    return Response.json({ available: true, tables: { modules, timetable, notebooks, pages, stickies, flashcards, quiz, grades, attachments, voice, stage, doubts, progress, books, moods, words, oral, plans, events, badges, focus } });
  } catch {
    return Response.json({ available: false });
  }
}
