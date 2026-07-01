const BASE = "/oyun/gunluk-kare-bulmaca";
const $ = id => document.getElementById(id);
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 6,
  maximumFractionDigits: 6
});
const dateTime = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  dateStyle: "medium",
  timeStyle: "short"
});

function setStatus(message) {
  $("status").textContent = message || "";
}

function formatMoney(value) {
  return money.format(Number(value || 0));
}

function clearTable(tbody, colspan, message = "Kayıt yok.") {
  tbody.innerHTML = "";
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.className = "sub";
  td.colSpan = colspan;
  td.textContent = message;
  tr.appendChild(td);
  tbody.appendChild(tr);
}

function td(text, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = text;
  return cell;
}

function renderDaily(days) {
  const tbody = $("dailyRows");
  tbody.innerHTML = "";
  if (!days || !days.length) {
    clearTable(tbody, 3);
    return;
  }
  for (const day of days) {
    const tr = document.createElement("tr");
    tr.appendChild(td(day.date || ""));
    tr.appendChild(td(String(day.count || 0)));
    tr.appendChild(td(formatMoney(day.totalCostUsd), "money"));
    tbody.appendChild(tr);
  }
}

function renderEntries(entries) {
  const tbody = $("entryRows");
  tbody.innerHTML = "";
  if (!entries || !entries.length) {
    clearTable(tbody, 4);
    return;
  }
  for (const entry of entries) {
    const tr = document.createElement("tr");
    const created = entry.createdAt ? dateTime.format(new Date(entry.createdAt)) : "";
    tr.appendChild(td(created));
    tr.appendChild(td([entry.provider, entry.model].filter(Boolean).join(" / ")));
    const status = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `pill ${entry.ok ? "ok" : "err"}`;
    pill.textContent = entry.ok ? "Tamamlandı" : "Hatalı";
    status.appendChild(pill);
    tr.appendChild(status);
    tr.appendChild(td(formatMoney(entry.totalCostUsd), "money"));
    tbody.appendChild(tr);
  }
}

function syncUrl() {
  const params = new URLSearchParams();
  const from = $("fromDate").value;
  const to = $("toDate").value;
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const next = params.toString() ? `?${params}` : location.pathname;
  history.replaceState(null, "", next);
}

async function loadCosts() {
  setStatus("Yükleniyor...");
  const params = new URLSearchParams();
  if ($("fromDate").value) params.set("from", $("fromDate").value);
  if ($("toDate").value) params.set("to", $("toDate").value);
  params.set("limit", "500");
  try {
    const res = await fetch(`${BASE}/api/admin/import-costs?${params}`, { headers: { "accept": "application/json" } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    $("totalCost").textContent = formatMoney(data.totalCostUsd);
    $("analysisCount").textContent = String(data.count || 0);
    renderDaily(data.days || []);
    renderEntries(data.entries || []);
    syncUrl();
    setStatus(data.count ? "" : "Bu aralıkta kayıt yok.");
  } catch (e) {
    $("totalCost").textContent = "$0.000000";
    $("analysisCount").textContent = "0";
    clearTable($("dailyRows"), 3, "Yüklenemedi.");
    clearTable($("entryRows"), 4, "Yüklenemedi.");
    setStatus(`Hata: ${(e && e.message) || e}`);
  }
}

function initFromUrl() {
  const params = new URLSearchParams(location.search);
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) $("fromDate").value = from;
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) $("toDate").value = to;
}

$("filterForm").addEventListener("submit", (e) => {
  e.preventDefault();
  loadCosts();
});
$("resetBtn").addEventListener("click", () => {
  $("fromDate").value = "";
  $("toDate").value = "";
  loadCosts();
});

initFromUrl();
loadCosts();
