import { json, error } from "../../../../_lib/http.js";
import { isISODate, todayInIstanbul } from "../../../../_lib/dates.js";
import { rowToPayload } from "../../../../_lib/puzzle.js";

// GET /oyun/gunluk-kare-bulmaca/api/puzzle/:date
// Taslak/ileri tarihli bulmacalar herkese açık olarak sunulmaz; yalnızca
// yayın tarihi gelmiş (<= bugün) kayıtlar görünür. Önizleme editör API'sinden.
export const onRequestGet = async ({ env, params }) => {
  const date = params.date;
  if (!isISODate(date)) return error("Geçersiz tarih.", 400);
  const row = await env.DB
    .prepare("SELECT puzzle_date,no,title,solution,clues,status FROM puzzles WHERE puzzle_date=?")
    .bind(date)
    .first();
  if (!row || (row.status === "draft") || date > todayInIstanbul()) {
    return error("Bulunamadı.", 404);
  }
  return json(rowToPayload(row), 200, { "cache-control": "public, max-age=3600" });
};
