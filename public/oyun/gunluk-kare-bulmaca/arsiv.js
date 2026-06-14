import { buildPuzzle } from "./shared/engine.js";

/* Mount tabanı — Cumhuriyet proxy'si bu yolu bu projeye yönlendirir. */
const BASE = "/oyun/gunluk-kare-bulmaca";
const MONTHS = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
const DAYS = ["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"];
const $ = (id) => document.getElementById(id);

const dt = (iso) => new Date(iso + "T00:00:00");
const trDate = (iso) => { const d = dt(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${DAYS[d.getDay()]}`; };
const monthKey = (iso) => { const d = dt(iso); return d.getFullYear() + "-" + d.getMonth(); };
const monthLabel = (iso) => { const d = dt(iso); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

/* ----- Bugünün bulmacası: yanıt yapısını oyuncuyla aynı API'den çekeriz.
   Önizlemede yalnız ızgara deseni (siyah kareler + numaralar) gösterilir;
   harfler asla çizilmez → çözüm sızdırılmaz. ----- */
async function loadToday() {
  try {
    const res = await fetch(`${BASE}/api/today`);
    if (res.ok) {
      const d = await res.json();
      if (d && d.solution) return { state: "ok", puzzle: d };
      return { state: "error" };
    }
    if (res.status === 404) return { state: "empty" };
    return { state: "error" };
  } catch (e) {
    return { state: "error" };
  }
}

async function loadList() {
  try {
    const res = await fetch(`${BASE}/api/list`);
    if (res.ok) return await res.json();
    return { puzzles: [] };
  } catch (e) {
    return { puzzles: [] };
  }
}

function renderHero(raw) {
  const P = buildPuzzle(raw);
  const cell = Math.max(13, Math.min(28, Math.floor(230 / Math.max(1, P.cols))));

  const board = document.createElement("div");
  board.className = "preview-board";
  board.style.gridTemplateColumns = `repeat(${P.cols}, var(--mini-cell))`;
  board.style.setProperty("--mini-cell", cell + "px");
  for (let r = 0; r < P.rows; r++) {
    for (let c = 0; c < P.cols; c++) {
      const el = document.createElement("div");
      el.className = "mcell" + (P.isBlack(r, c) ? " black" : "");
      const n = !P.isBlack(r, c) && P.numberAt[r + "," + c];
      if (n) { const ns = document.createElement("span"); ns.className = "mnum"; ns.textContent = n; el.appendChild(ns); }
      board.appendChild(el);
    }
  }

  const meta = document.createElement("div");
  meta.className = "hero-meta";
  meta.innerHTML =
    `<div class="hero-kicker">${trDate(P.date)}</div>` +
    `<div class="hero-title">${P.title || "Günün Kare Bulmacası"}</div>` +
    `<div class="hero-sub">No: ${P.no || "—"} · ${P.cols}×${P.rows}</div>` +
    `<span class="hero-cta">Bugünü Çöz →</span>`;

  // Tüm kart bugünün gerçek URL'sine gider (kök = bugün).
  const card = document.createElement("a");
  card.className = "hero";
  card.href = `${BASE}/`;
  const grid = document.createElement("div");
  grid.className = "hero-grid";
  grid.appendChild(board);
  card.appendChild(grid);
  card.appendChild(meta);

  $("heroSlot").innerHTML = "";
  $("heroSlot").appendChild(card);
}

function renderHeroEmpty(state) {
  const msg = state === "empty"
    ? "Bugün için henüz bulmaca yayımlanmamış. Arşivden diğer günleri çözebilirsiniz."
    : "Bugünün bulmacası şu an yüklenemedi. Lütfen biraz sonra tekrar deneyin.";
  $("heroSlot").innerHTML = `<div class="hero-empty">${msg}</div>`;
}

function renderList(data) {
  const wrap = $("archiveList");
  const puzzles = data.puzzles || [];
  const today = data.today;
  if (!puzzles.length) {
    wrap.innerHTML = `<p class="empty">Henüz yayımlanmış bulmaca yok.</p>`;
    return;
  }
  let html = "";
  let curKey = null;
  for (const p of puzzles) {
    const k = monthKey(p.date);
    if (k !== curKey) {
      if (curKey !== null) html += "</div>";
      html += `<div class="month">${monthLabel(p.date)}</div><div class="days">`;
      curKey = k;
    }
    const d = dt(p.date);
    const isToday = p.date === today;
    html +=
      `<a class="day${isToday ? " today" : ""}" href="${BASE}/${p.urlDate}" title="${(p.title || "").replace(/"/g, "&quot;")}">` +
      `<span class="dnum">${d.getDate()}</span>` +
      `<span class="dwd">${DAYS[d.getDay()].slice(0, 3)}</span>` +
      `<span class="dno">No ${p.no || "—"}</span>` +
      `</a>`;
  }
  if (curKey !== null) html += "</div>";
  wrap.innerHTML = html;
}

loadToday().then((r) => {
  if (r.state === "ok") renderHero(r.puzzle);
  else renderHeroEmpty(r.state);
});
loadList().then(renderList);
