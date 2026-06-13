-- Cumhuriyet Günlük Kare Bulmaca — D1 şeması
-- Bulmacalar yayın gününe (Europe/Istanbul, YYYY-MM-DD) göre saklanır.
-- "Bugünün bulmacası" = puzzle_date == bugün olan satır. Cron yok: ileri
-- tarihli bir satır, tarihi geldiğinde kendiliğinden yayına girer.

CREATE TABLE IF NOT EXISTS puzzles (
  puzzle_date  TEXT PRIMARY KEY,                 -- YYYY-MM-DD (Istanbul)
  no           TEXT,                             -- gazete bulmaca numarası
  title        TEXT,
  status       TEXT NOT NULL DEFAULT 'draft',    -- draft | scheduled
  solution     TEXT NOT NULL,                    -- JSON: ["TAM#", ...]
  clues        TEXT NOT NULL,                    -- JSON: {across:{}, down:{}}
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_puzzles_status ON puzzles(status);
