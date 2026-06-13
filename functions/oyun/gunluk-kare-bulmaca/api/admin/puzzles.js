import { json } from "../../../../_lib/http.js";
import { validate } from "../../../../_lib/engine.js";
import { isISODate } from "../../../../_lib/dates.js";

// Bu yol /api/admin/* altında olduğundan _middleware Basic auth ile korur.

// GET — kayıtlı bulmacaların listesi (editör paneli için)
export const onRequestGet = async ({ env }) => {
  const { results } = await env.DB
    .prepare("SELECT puzzle_date,no,title,status,updated_at FROM puzzles ORDER BY puzzle_date DESC LIMIT 200")
    .all();
  return json({ puzzles: results || [] }, 200, { "cache-control": "no-store" });
};

// POST — doğrula + kaydet (taslak | zamanla). Izgaradan otomatik üretilen
// kelimeler/numaralar motorla doğrulanır.
export const onRequestPost = async ({ env, request }) => {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Geçersiz JSON." }, 400); }

  if (!isISODate(body.date)) return json({ ok: false, error: "Geçersiz yayın tarihi." }, 400);

  const v = validate(body);
  if (!v.ok) return json({ ok: false, errors: v.errors, warnings: v.warnings }, 422);

  const status = body.status === "scheduled" ? "scheduled" : "draft";
  await env.DB
    .prepare(
      `INSERT INTO puzzles (puzzle_date,no,title,status,solution,clues,updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,datetime('now'))
       ON CONFLICT(puzzle_date) DO UPDATE SET
         no=excluded.no, title=excluded.title, status=excluded.status,
         solution=excluded.solution, clues=excluded.clues, updated_at=datetime('now')`
    )
    .bind(body.date, body.no || "", body.title || "", status,
          JSON.stringify(body.solution), JSON.stringify(body.clues))
    .run();

  return json({ ok: true, warnings: v.warnings }, 200, { "cache-control": "no-store" });
};
