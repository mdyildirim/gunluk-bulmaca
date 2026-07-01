-- LLM import charge ledger.
-- Only the multiplied client-facing total is persisted; raw provider costs are
-- not stored as separate values.

CREATE TABLE IF NOT EXISTS llm_import_costs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at         TEXT NOT NULL,
  charge_date        TEXT NOT NULL,              -- Europe/Istanbul, YYYY-MM-DD
  provider           TEXT NOT NULL,
  model              TEXT NOT NULL,
  ok                 INTEGER NOT NULL DEFAULT 0,
  total_cost_micros  INTEGER NOT NULL,           -- multiplied total, USD * 1e6
  currency           TEXT NOT NULL DEFAULT 'USD'
);

CREATE INDEX IF NOT EXISTS idx_llm_import_costs_charge_date
  ON llm_import_costs(charge_date);

CREATE INDEX IF NOT EXISTS idx_llm_import_costs_created_at
  ON llm_import_costs(created_at);
