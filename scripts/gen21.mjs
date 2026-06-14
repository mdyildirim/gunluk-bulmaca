// Örnek 21×21 bulmaca üretici (yalnızca yerel test / mobil yerleşim denemesi için).
// Simetrik siyah kare deseni + her kelimeye otomatik ipucu → kalabalık ızgara
// ve uzun ipucu listelerinin mobilde nasıl göründüğünü görmek için.
import { normalizeSolution, buildWords } from "../public/oyun/gunluk-kare-bulmaca/shared/engine.js";
import { writeFileSync } from "node:fs";

const N = 21;
// 4'lük örgüde, iç içe iki simetrik kafes → izole siyah kareler (1 harflik
// kelime yok, tüm beyazlar bağlı). 180° döndürme simetrik.
const isBlack = (r, c) => (r % 4 === 2 && c % 4 === 2) || (r % 4 === 0 && c % 4 === 0);
const TR = "ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ";

const rows = [];
for (let r = 0; r < N; r++) {
  let row = "";
  for (let c = 0; c < N; c++) row += isBlack(r, c) ? "#" : TR[(r * 3 + c * 7 + 5) % TR.length];
  rows.push(row);
}

const { rows: R, cols: C, sol } = normalizeSolution(rows);
const { words } = buildWords(sol, R, C);

const clues = { across: {}, down: {} };
const label = d => (d === "across" ? "Soldan sağa" : "Yukarıdan aşağıya");
for (const w of words) {
  // Sarma davranışını görmek için bazıları uzun tutuldu.
  const long = w.num % 5 === 0 ? " — bu uzun bir örnek ipucudur, mobilde satır sarmasını göstermek içindir" : "";
  clues[w.dir][String(w.num)] = `Örnek ipucu ${w.num} (${label(w.dir)}, ${w.cells.length} harf)${long}`;
}

const date = "2026-06-14";
const esc = s => JSON.stringify(s).replace(/'/g, "''");
const sql =
  `DELETE FROM puzzles WHERE puzzle_date='${date}';\n` +
  `INSERT INTO puzzles (puzzle_date,no,title,status,solution,clues) VALUES ` +
  `('${date}','S21','Örnek 21×21 Bulmaca','scheduled','${esc(rows)}','${esc(clues)}');\n`;

writeFileSync("/tmp/gen21.sql", sql);
const a = words.filter(w => w.dir === "across").length;
console.log(`${R}×${C} · kelime: ${words.length} (soldan sağa ${a}, yukarıdan aşağıya ${words.length - a}) · SQL → /tmp/gen21.sql`);
