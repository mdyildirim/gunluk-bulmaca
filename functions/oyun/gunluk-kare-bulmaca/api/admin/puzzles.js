import { json } from "../../../../_lib/http.js";
import { validate } from "../../../../_lib/engine.js";
import { isISODate, todayInIstanbul } from "../../../../_lib/dates.js";

// Bu yol /api/admin/* altında olduğundan _middleware Basic auth ile korur.

function cleanMedia(media) {
  return (Array.isArray(media) ? media : [])
    .filter(m => m && m.type === "image" && typeof m.src === "string" && m.src.startsWith("data:image/"))
    .map(m => ({
      type: "image",
      src: m.src,
      row: Math.max(1, Math.trunc(Number(m.row) || 1)),
      col: Math.max(1, Math.trunc(Number(m.col) || 1)),
      rows: Math.max(1, Math.trunc(Number(m.rows) || 1)),
      cols: Math.max(1, Math.trunc(Number(m.cols) || 1))
    }))
    .slice(0, 1);
}

function cluesForStorage(clues, media) {
  const out = {
    across: { ...((clues && clues.across) || {}) },
    down: { ...((clues && clues.down) || {}) }
  };
  const clean = cleanMedia(media);
  if (clean.length) out.__media = clean;
  return out;
}

// GET — kayıtlı bulmacaların listesi (editör paneli için)
export const onRequestGet = async ({ env }) => {
  const today = todayInIstanbul();
  const { results } = await env.DB
    .prepare("SELECT puzzle_date,no,title,status,updated_at FROM puzzles ORDER BY puzzle_date DESC LIMIT 200")
    .all();
  return json({ today, puzzles: results || [] }, 200, { "cache-control": "no-store" });
};

// POST — doğrula + kaydet (taslak | planla). Izgaradan otomatik üretilen
// kelimeler/numaralar motorla doğrulanır.
export const onRequestPost = async ({ env, request }) => {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Geçersiz JSON." }, 400); }

  if (!isISODate(body.date)) return json({ ok: false, error: "Geçersiz yayın tarihi." }, 400);

  const v = validate(body);
  if (!v.ok) return json({ ok: false, errors: v.errors, warnings: v.warnings }, 422);

  const status = body.status === "scheduled" ? "scheduled" : "draft";
  const clues = cluesForStorage(body.clues, body.media);
  await env.DB
    .prepare(
      `INSERT INTO puzzles (puzzle_date,no,title,status,solution,clues,updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,datetime('now'))
       ON CONFLICT(puzzle_date) DO UPDATE SET
         no=excluded.no, title=excluded.title, status=excluded.status,
         solution=excluded.solution, clues=excluded.clues, updated_at=datetime('now')`
    )
    .bind(body.date, body.no || "", body.title || "", status,
          JSON.stringify(body.solution), JSON.stringify(clues))
    .run();

  return json({ ok: true, warnings: v.warnings }, 200, { "cache-control": "no-store" });
};

// DELETE — planlı bulmacaları sil. Geçmiş tarihli planlı kayıtlar da arşivden
// kaldırılabilir; taslaklar bu işlemle silinmez.
export const onRequestDelete = async ({ env, request }) => {
  const date = new URL(request.url).searchParams.get("date");
  if (!isISODate(date)) return json({ ok: false, error: "Geçersiz yayın tarihi." }, 400);

  const row = await env.DB
    .prepare("SELECT status FROM puzzles WHERE puzzle_date=?")
    .bind(date)
    .first();
  if (!row) return json({ ok: false, error: "Bulmaca bulunamadı." }, 404, { "cache-control": "no-store" });
  if (row.status !== "scheduled") {
    return json({ ok: false, error: "Yalnızca planlı bulmacalar silinebilir." }, 409, { "cache-control": "no-store" });
  }

  const result = await env.DB
    .prepare("DELETE FROM puzzles WHERE puzzle_date=? AND status='scheduled'")
    .bind(date)
    .run();
  if (!result.meta || result.meta.changes !== 1) {
    return json({ ok: false, error: "Bulmaca silinemedi." }, 409, { "cache-control": "no-store" });
  }

  return json({ ok: true }, 200, { "cache-control": "no-store" });
};
