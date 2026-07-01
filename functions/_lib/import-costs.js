export const IMPORT_COST_MULTIPLIER = 3;
export const COST_CURRENCY = "USD";
const MICROS_PER_USD = 1000000;

const CREATE_COSTS_TABLE = `
CREATE TABLE IF NOT EXISTS llm_import_costs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at         TEXT NOT NULL,
  charge_date        TEXT NOT NULL,
  provider           TEXT NOT NULL,
  model              TEXT NOT NULL,
  ok                 INTEGER NOT NULL DEFAULT 0,
  total_cost_micros  INTEGER NOT NULL,
  currency           TEXT NOT NULL DEFAULT 'USD'
)`;

const CREATE_COSTS_DATE_INDEX =
  "CREATE INDEX IF NOT EXISTS idx_llm_import_costs_charge_date ON llm_import_costs(charge_date)";
const CREATE_COSTS_CREATED_INDEX =
  "CREATE INDEX IF NOT EXISTS idx_llm_import_costs_created_at ON llm_import_costs(created_at)";

let costStoreReady = false;

export function dateInIstanbul(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(date);
}

export function usdFromMicros(micros) {
  const n = Number(micros || 0);
  return Number.isFinite(n) ? n / MICROS_PER_USD : 0;
}

export function chargeFromProviderCost(providerCostUsd) {
  const raw = Number(providerCostUsd);
  const totalCostMicros = Number.isFinite(raw) && raw > 0
    ? Math.round(raw * IMPORT_COST_MULTIPLIER * MICROS_PER_USD)
    : 0;
  return {
    totalCostMicros,
    totalCostUsd: usdFromMicros(totalCostMicros),
    currency: COST_CURRENCY
  };
}

export async function ensureImportCostStore(env) {
  if (!env || !env.DB) throw new Error("DB binding tanımlı değil.");
  if (costStoreReady) return;
  await env.DB.batch([
    env.DB.prepare(CREATE_COSTS_TABLE),
    env.DB.prepare(CREATE_COSTS_DATE_INDEX),
    env.DB.prepare(CREATE_COSTS_CREATED_INDEX)
  ]);
  costStoreReady = true;
}

export async function recordImportCost(env, { provider, model, ok, totalCostUsd }) {
  await ensureImportCostStore(env);
  const totalCostMicros = Math.max(0, Math.round(Number(totalCostUsd || 0) * MICROS_PER_USD));
  if (!totalCostMicros) return null;
  const createdAt = new Date();
  const chargeDate = dateInIstanbul(createdAt);
  const result = await env.DB.prepare(
    `INSERT INTO llm_import_costs
      (created_at, charge_date, provider, model, ok, total_cost_micros, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    createdAt.toISOString(),
    chargeDate,
    String(provider || ""),
    String(model || ""),
    ok ? 1 : 0,
    totalCostMicros,
    COST_CURRENCY
  ).run();
  return {
    id: result && result.meta && result.meta.last_row_id,
    chargeDate,
    totalCostMicros,
    totalCostUsd: usdFromMicros(totalCostMicros),
    currency: COST_CURRENCY
  };
}
