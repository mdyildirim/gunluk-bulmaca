import { json } from "../../../../_lib/http.js";
import { isISODate } from "../../../../_lib/dates.js";
import { COST_CURRENCY, ensureImportCostStore, usdFromMicros } from "../../../../_lib/import-costs.js";

const MAX_LIMIT = 1000;

function bind(stmt, params) {
  return params.length ? stmt.bind(...params) : stmt;
}

function parseLimit(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 200;
  return Math.min(MAX_LIMIT, n);
}

export const onRequestGet = async ({ env, request }) => {
  try {
    await ensureImportCostStore(env);
  } catch (e) {
    return json({
      ok: false,
      error: "Maliyet kaydı için DB hazır değil.",
      detail: String(e && e.message || e).slice(0, 200)
    }, 503, { "cache-control": "no-store" });
  }

  const url = new URL(request.url);
  const from = (url.searchParams.get("from") || "").trim();
  const to = (url.searchParams.get("to") || "").trim();
  const limit = parseLimit(url.searchParams.get("limit"));

  if (from && !isISODate(from)) return json({ ok: false, error: "Geçersiz başlangıç tarihi." }, 400);
  if (to && !isISODate(to)) return json({ ok: false, error: "Geçersiz bitiş tarihi." }, 400);
  if (from && to && from > to) return json({ ok: false, error: "Başlangıç tarihi bitişten sonra olamaz." }, 400);

  const clauses = [];
  const params = [];
  if (from) { clauses.push("charge_date >= ?"); params.push(from); }
  if (to) { clauses.push("charge_date <= ?"); params.push(to); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const [summary, daily, entries] = await env.DB.batch([
    bind(env.DB.prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_cost_micros), 0) AS total_cost_micros
       FROM llm_import_costs ${where}`
    ), params),
    bind(env.DB.prepare(
      `SELECT charge_date, COUNT(*) AS count, COALESCE(SUM(total_cost_micros), 0) AS total_cost_micros
       FROM llm_import_costs ${where}
       GROUP BY charge_date
       ORDER BY charge_date DESC`
    ), params),
    env.DB.prepare(
      `SELECT id, created_at, charge_date, provider, model, ok, total_cost_micros, currency
       FROM llm_import_costs ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    ).bind(...params, limit)
  ]);

  const total = (summary.results && summary.results[0]) || {};
  const rows = entries.results || [];
  const days = daily.results || [];

  return json({
    ok: true,
    from: from || null,
    to: to || null,
    currency: COST_CURRENCY,
    count: Number(total.count || 0),
    totalCostUsd: usdFromMicros(total.total_cost_micros),
    days: days.map((row) => ({
      date: row.charge_date,
      count: Number(row.count || 0),
      totalCostUsd: usdFromMicros(row.total_cost_micros),
      currency: row.currency || COST_CURRENCY
    })),
    entries: rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      date: row.charge_date,
      provider: row.provider,
      model: row.model,
      ok: !!row.ok,
      totalCostUsd: usdFromMicros(row.total_cost_micros),
      currency: row.currency || COST_CURRENCY
    }))
  }, 200, { "cache-control": "no-store" });
};
