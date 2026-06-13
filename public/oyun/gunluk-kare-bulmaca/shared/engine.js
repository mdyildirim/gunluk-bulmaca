/* =========================================================================
   Kare Bulmaca — paylaşılan motor (browser + Cloudflare Worker, ESM)
   Çözülmüş ızgaradan otomatik numaralandırma, kelime tespiti ve doğrulama.
   Veri biçimi:
     {
       date: "2026-06-13",
       no: "13",
       title: "Günün Kare Bulmacası",
       solution: ["TAM#", "E#AY", ...],   // '#' = siyah kare
       clues: { across: { "1":"...", "3":"..." }, down: { "1":"...", ... } }
     }
   ========================================================================= */

export const TR_UP = s => (s || "").toLocaleUpperCase("tr-TR");

// URL tarih biçimi Türkçe: GG-AA-YYYY (ör. 13-06-2026).
// Dahili/DB biçimi ISO: YYYY-AA-GG (sıralama + birincil anahtar için).
export const isUrlDate = (s) => /^\d{2}-\d{2}-\d{4}$/.test(s || "");
export function urlDateToIso(s) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
export function isoToUrlDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// İzin verilen ızgara harfleri (Türkçe dahil). Siyah kare = '#'.
const ALLOWED = "ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ";
export const isLetter = ch => ALLOWED.includes(TR_UP(ch));

export function normalizeSolution(solution) {
  const rows = solution.length;
  const cols = Math.max(0, ...solution.map(r => r.length));
  const sol = solution.map(r => TR_UP(r).padEnd(cols, "#").split(""));
  return { rows, cols, sol };
}

/* Izgaradan kelimeleri ve numaraları türet. */
export function buildWords(sol, rows, cols) {
  const isBlack = (r, c) => r < 0 || c < 0 || r >= rows || c >= cols || sol[r][c] === "#";
  const numberAt = {};
  const words = [];
  let n = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isBlack(r, c)) continue;
      const startA = isBlack(r, c - 1) && !isBlack(r, c + 1);
      const startD = isBlack(r - 1, c) && !isBlack(r + 1, c);
      if (startA || startD) {
        numberAt[r + "," + c] = n;
        if (startA) {
          const cells = []; let cc = c;
          while (!isBlack(r, cc)) { cells.push({ r, c: cc }); cc++; }
          words.push({ dir: "across", num: n, cells });
        }
        if (startD) {
          const cells = []; let rr = r;
          while (!isBlack(rr, c)) { cells.push({ r: rr, c }); rr++; }
          words.push({ dir: "down", num: n, cells });
        }
        n++;
      }
    }
  }
  // hücre -> ait olduğu kelimeler
  const cellWords = {};
  words.forEach(w => w.cells.forEach(({ r, c }) => {
    const k = r + "," + c; (cellWords[k] = cellWords[k] || {})[w.dir] = w;
  }));
  return { numberAt, words, cellWords, isBlack };
}

/* Tam bir oynanabilir model üret (ipuçlarını numaraya göre bağlar). */
export function buildPuzzle(puzzle) {
  const { rows, cols, sol } = normalizeSolution(puzzle.solution);
  const { numberAt, words, cellWords, isBlack } = buildWords(sol, rows, cols);
  const clues = puzzle.clues || { across: {}, down: {} };
  words.forEach(w => {
    w.clue = (clues[w.dir] && clues[w.dir][String(w.num)]) || "";
    w.answer = w.cells.map(({ r, c }) => sol[r][c]).join("");
    w.key = w.num + "," + w.dir;
  });
  return { rows, cols, sol, numberAt, words, cellWords, isBlack,
           date: puzzle.date, no: puzzle.no, title: puzzle.title };
}

/* Editör/yükleme doğrulaması — yayından önce çalışır. */
export function validate(puzzle) {
  const errors = [];
  const warnings = [];
  if (!puzzle.solution || !puzzle.solution.length) {
    errors.push("Izgara boş.");
    return { ok: false, errors, warnings };
  }
  const { rows, cols, sol } = normalizeSolution(puzzle.solution);

  // 1) Geçersiz karakter kontrolü
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = sol[r][c];
      if (ch !== "#" && !ALLOWED.includes(ch)) {
        errors.push(`Geçersiz karakter "${ch}" — satır ${r + 1}, sütun ${c + 1}.`);
      }
    }
  }

  const { words, isBlack } = buildWords(sol, rows, cols);

  // 2) Tek harflik beyaz hücre (hiçbir kelimeye ait değil) uyarısı
  const inWord = new Set();
  words.forEach(w => w.cells.forEach(({ r, c }) => inWord.add(r + "," + c)));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (!isBlack(r, c) && !inWord.has(r + "," + c))
        warnings.push(`Tek başına (kelimesiz) hücre: satır ${r + 1}, sütun ${c + 1}.`);

  // 3) Eksik ipuçları
  const clues = puzzle.clues || { across: {}, down: {} };
  words.forEach(w => {
    const t = clues[w.dir] && clues[w.dir][String(w.num)];
    if (!t || !String(t).trim())
      errors.push(`İpucu eksik: ${w.num} ${w.dir === "across" ? "Soldan Sağa" : "Yukarıdan Aşağıya"}.`);
  });

  // 4) Eşleşmeyen ipucu (numarası olmayan)
  const validKeys = new Set(words.map(w => w.dir + ":" + w.num));
  ["across", "down"].forEach(dir => {
    Object.keys(clues[dir] || {}).forEach(num => {
      if (!validKeys.has(dir + ":" + num))
        warnings.push(`Fazladan ipucu (kelime yok): ${num} ${dir}.`);
    });
  });

  // 5) Bağlantısallık (tüm beyaz kareler tek parça mı?)
  const whites = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) if (!isBlack(r, c)) whites.push(r + "," + c);
  if (whites.length) {
    const seen = new Set([whites[0]]);
    const stack = [whites[0]];
    while (stack.length) {
      const [r, c] = stack.pop().split(",").map(Number);
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dr, dc]) => {
        const k = (r + dr) + "," + (c + dc);
        if (!isBlack(r + dr, c + dc) && !seen.has(k)) { seen.add(k); stack.push(k); }
      });
    }
    if (seen.size !== whites.length)
      warnings.push("Izgara bağlantısız: bazı kareler ana bloğa bağlı değil.");
  }

  return { ok: errors.length === 0, errors, warnings,
           wordCount: words.length, rows, cols };
}
