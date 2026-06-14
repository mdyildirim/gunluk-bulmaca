import { json } from "../../../_lib/http.js";
import { todayInIstanbul } from "../../../_lib/dates.js";
import { isoToUrlDate } from "../../../_lib/engine.js";

// GET /oyun/gunluk-kare-bulmaca/api/list
// Yayında olan (taslak değil, tarihi gelmiş) bulmacaları en yeni → en eski
// listeler. Çözüm/ipuçlarını taşımaz; yalnız arşiv listesi ve önizleme künyesi.
export const onRequestGet = async ({ env }) => {
  const today = todayInIstanbul();
  const { results } = await env.DB
    .prepare("SELECT puzzle_date,no,title FROM puzzles WHERE status!='draft' AND puzzle_date<=? ORDER BY puzzle_date DESC LIMIT 366")
    .bind(today)
    .all();

  const puzzles = (results || []).map((r) => ({
    date: r.puzzle_date,
    urlDate: isoToUrlDate(r.puzzle_date),
    no: r.no,
    title: r.title
  }));

  return json({ today, count: puzzles.length, puzzles }, 200, {
    "cache-control": "public, max-age=300"
  });
};
