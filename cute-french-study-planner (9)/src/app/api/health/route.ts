import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  // Data lives in the browser; without a server database the app is still healthy.
  if (!process.env.DATABASE_URL) return Response.json({ ok: true, storage: "browser" });
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
