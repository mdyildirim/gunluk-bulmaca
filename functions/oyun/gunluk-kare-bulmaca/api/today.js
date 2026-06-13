import { json, error } from "../../../_lib/http.js";
import { todayInIstanbul } from "../../../_lib/dates.js";
import { rowToPayload } from "../../../_lib/puzzle.js";

// GET /oyun/gunluk-kare-bulmaca/api/today
// "Bugün" = Europe/Istanbul tarihi olan satır. Kısa TTL: gün dönümünde tazelenir.
export const onRequestGet = async ({ env }) => {
  const date = todayInIstanbul();
  const row = await env.DB
    .prepare("SELECT puzzle_date,no,title,solution,clues FROM puzzles WHERE puzzle_date=?")
    .bind(date)
    .first();
  if (!row) return error("Bugün için bulmaca yok.", 404);
  return json(rowToPayload(row), 200, { "cache-control": "public, max-age=60" });
};
