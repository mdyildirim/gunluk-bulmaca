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

/* =========================================================================
   Görselden içe aktarma uzlaştırması.
   LLM çıktısını ({grid:[satır...], clues:[{answer,clue,dir}]}) editörün beklediği
   biçime ({solution, clues:{across,down}}) çevirir ve insan incelemesi için
   "issues" üretir. Numaralandırma/kelime sınırları yine ızgaradan türetilir
   (buildWords); ipuçları (answer + yön) ile türetilen kelimelere eşlenir.
   ========================================================================= */

// Yön etiketini normalle: "across"/"down". Aşağı/yukarı göstergeleri ÖNCE
// kontrol edilir ("aşağı" 'a' ile başlar; across yanlışına düşmesin).
export function normDir(d) {
  const s = (d == null ? "" : String(d)).toLocaleLowerCase("tr-TR").trim();
  if (s === "across" || s === "down") return s;
  if (s.includes("aşağ") || s.includes("asağ") || s.includes("asag") ||
      s.includes("yukar") || s.startsWith("d") || s.startsWith("y")) return "down";
  return "across"; // across / "soldan sağa" / varsayılan
}

// Cevabı yalnızca izin verilen Türkçe büyük harflere indir (boşluk/noktalama at).
export function normAnswer(a) {
  return TR_UP(a == null ? "" : String(a)).split("").filter(ch => ALLOWED.includes(ch)).join("");
}

export function slotIdForWord(w) {
  return `${w && w.dir === "down" ? "D" : "A"}${w && w.num}`;
}

export function normalizeSlotId(id) {
  return String(id == null ? "" : id).trim().toLocaleUpperCase("tr-TR")
    .replace(/\s+/g, "")
    .replace(/^ACROSS:?/, "A")
    .replace(/^DOWN:?/, "D")
    .replace(/^A:/, "A")
    .replace(/^D:/, "D");
}

export function slotCatalogFromSolution(solution) {
  const { rows, cols, sol } = normalizeSolution(Array.isArray(solution) ? solution : []);
  const { words } = buildWords(sol, rows, cols);
  return words.map(w => ({
    id: slotIdForWord(w),
    num: w.num,
    dir: w.dir,
    answer: w.cells.map(({ r, c }) => sol[r][c]).join("")
  }));
}

export function reconcileImport(input) {
  const issues = [];
  const rawGrid = Array.isArray(input && input.grid)
    ? input.grid.map(r => (r == null ? "" : String(r))) : [];
  if (!rawGrid.length) {
    return { solution: [], clues: { across: {}, down: {} },
             issues: [{ level: "error", msg: "LLM bir ızgara döndürmedi." }] };
  }

  // Satır uzunlukları eşit mi? (ucuz ön kontrol)
  const widths = rawGrid.map(r => TR_UP(r).length);
  const maxW = Math.max(...widths);
  if (widths.some(w => w !== maxW))
    issues.push({ level: "warn",
      msg: `Satır uzunlukları eşit değil (en geniş ${maxW}); kısa satırlar '#' ile dolduruldu — hizalamayı kontrol edin.` });

  const { rows, cols, sol } = normalizeSolution(rawGrid);
  const solution = sol.map(r => r.join(""));
  const { words } = buildWords(sol, rows, cols);
  words.forEach(w => {
    w._ans = w.cells.map(({ r, c }) => sol[r][c]).join("");
    w._slot = slotIdForWord(w);
  });

  // İpuçlarını önce slot ID ile bağla. Slot ID yoksa eski answer+dir eşleşmesine
  // düşeriz. Slot yolu, LLM'in ipucundan cevap uydurmasını ızgaraya yazdırmaz.
  const out = { across: {}, down: {} };
  const used = new Set();
  const dirTr = dir => dir === "across" ? "Soldan Sağa" : "Yukarıdan Aşağıya";
  const llmClues = Array.isArray(input.clues) ? input.clues : [];
  for (const lc of llmClues) {
    const dir = normDir(lc && lc.dir);
    const ans = normAnswer(lc && lc.answer);
    const slot = normalizeSlotId(lc && lc.slot);
    const text = (lc && lc.clue != null ? String(lc.clue) : "").trim();
    if (lc && lc.unmatchedSlot) {
      issues.push({ level: "warn", msg: `Eşleşmeyen slot: "${slot || "?"}" — "${text.slice(0, 60)}" ipucu elle bağlanmalı.` });
      continue;
    }
    if (slot && slot !== "?") {
      const cand = words.find(w => w._slot === slot && !used.has(w.dir + ":" + w.num));
      if (cand) {
        used.add(cand.dir + ":" + cand.num);
        out[cand.dir][String(cand.num)] = text;
      } else {
        issues.push({ level: "warn", msg: `Eşleşmeyen slot: "${slot}" — ızgarada böyle bir kelime yok.` });
      }
      continue;
    }
    if (!ans) {
      issues.push({ level: "warn", msg: `Cevapsız ipucu atlandı: "${text.slice(0, 40)}".` });
      continue;
    }
    const cand = words.find(w => w.dir === dir && w._ans === ans && !used.has(dir + ":" + w.num));
    if (cand) {
      used.add(dir + ":" + cand.num);
      out[dir][String(cand.num)] = text;
    } else {
      issues.push({ level: "warn",
        msg: `Eşleşmeyen ipucu: "${ans}" (${dirTr(dir)}) ızgarada böyle bir kelime yok — yanlış okunmuş harf ya da fazladan ipucu olabilir.` });
    }
  }

  // İpucu atanmamış (LLM'in kaçırdığı) kelimeler — insan bunları doldurur.
  for (const w of words) {
    const t = out[w.dir][String(w.num)];
    if (!t || !t.trim())
      issues.push({ level: "info", msg: `Eksik ipucu: ${w.num} ${dirTr(w.dir)} (${w._ans}).` });
  }

  return { solution, clues: out, issues };
}

/* =========================================================================
   Kelime listesinden ızgara kurma (tercih edilen yol).
   LLM her kelimeyi {answer, clue, dir, row, col} olarak verir; ızgarayı BİZ
   kurarız. Bulmacanın doğasından gelen artıklık sayesinde her harf hücresi iki
   kez (yatay + dikey kelimeden) okunur: kesişimde harfler UYUŞUYORSA güvenilir;
   UYUŞMUYORSA o hücre tam koordinatıyla işaretlenir (insan hangi harf doğruysa
   onu seçer). Böylece insan ızgarayı yeniden kurmaz, yalnızca işaretli hücrelerde
   harf seçer ve eksik ipuçlarını (cevabı görünür) doldurur.
   ========================================================================= */
export function reconcileWords(input) {
  const issues = [];
  const dirTr = dir => dir === "across" ? "Soldan Sağa" : "Yukarıdan Aşağıya";
  const raw = Array.isArray(input && input.words) ? input.words : [];
  if (!raw.length)
    return { solution: [], clues: { across: {}, down: {} },
             issues: [{ level: "error", msg: "LLM kelime listesi döndürmedi." }] };

  // Kelimeleri normalle + doğrula.
  const W = [];
  for (const w of raw) {
    const dir = normDir(w && w.dir);
    const ans = normAnswer(w && w.answer);
    const clue = (w && w.clue != null ? String(w.clue) : "").trim();
    const row = Math.trunc(Number(w && w.row));
    const col = Math.trunc(Number(w && w.col));
    if (!ans) { issues.push({ level: "warn", msg: `Cevapsız kelime atlandı: "${clue.slice(0, 40)}".` }); continue; }
    if (!Number.isFinite(row) || !Number.isFinite(col) || row < 0 || col < 0) {
      issues.push({ level: "warn", msg: `Geçersiz konumlu kelime atlandı: "${ans}" (${dirTr(dir)}).` }); continue;
    }
    W.push({ ans, clue, dir, row, col, len: ans.length, used: false });
  }
  if (!W.length)
    return { solution: [], clues: { across: {}, down: {} },
             issues: [...issues, { level: "error", msg: "Konumlu hiçbir kelime yok." }] };

  // Izgara boyutu: verilen rows/cols + tüm kelime uçlarını kapsayacak şekilde genişlet.
  let rows = Math.max(0, Math.trunc(Number(input.rows)) || 0);
  let cols = Math.max(0, Math.trunc(Number(input.cols)) || 0);
  for (const w of W) {
    rows = Math.max(rows, w.dir === "down" ? w.row + w.len : w.row + 1);
    cols = Math.max(cols, w.dir === "across" ? w.col + w.len : w.col + 1);
  }

  // Harfleri boya: her hücre için yatay ve dikey iddiaları ayrı tut.
  const acrossAt = {}, downAt = {};
  for (const w of W) {
    const map = w.dir === "across" ? acrossAt : downAt;
    for (let k = 0; k < w.len; k++) {
      const r = w.dir === "down" ? w.row + k : w.row;
      const c = w.dir === "across" ? w.col + k : w.col;
      const key = r + "," + c;
      if (map[key])
        issues.push({ level: "warn",
          msg: `Çakışan ${w.dir === "across" ? "yatay" : "dikey"} kelimeler: "${map[key].w.ans}" ve "${w.ans}" (satır ${r + 1}, sütun ${c + 1}).` });
      else map[key] = { ch: w.ans[k], w };
    }
  }

  // Hücreleri çöz: yatay/dikey uyuşuyorsa harf; uyuşmuyorsa çakışma (işaretle);
  // hiçbiri yoksa siyah kare.
  const conflicts = [];
  const sol = [];
  for (let r = 0; r < rows; r++) {
    let row = "";
    for (let c = 0; c < cols; c++) {
      const a = acrossAt[r + "," + c], d = downAt[r + "," + c];
      if (!a && !d) { row += "#"; continue; }
      if (a && d && a.ch !== d.ch) {
        conflicts.push({ r, c, a, d });
        row += a.ch; // belirlenimci seçim; insan editörde düzeltir
      } else row += (a ? a.ch : d.ch);
    }
    sol.push(row);
  }
  conflicts.forEach(cf => issues.push({ level: "warn",
    msg: `Harf çakışması (satır ${cf.r + 1}, sütun ${cf.c + 1}): yatay "${cf.a.w.ans}" → '${cf.a.ch}', dikey "${cf.d.w.ans}" → '${cf.d.ch}'. Birini seçin.` }));

  // Numaralandırma + ipucu bağlama: kurulan ızgaradan kelimeleri türet, LLM
  // kelimeleriyle başlangıç hücresi+yöne (yedek: cevap+yön) göre eşle.
  const norm = normalizeSolution(sol);
  const { words: derived } = buildWords(norm.sol, norm.rows, norm.cols);
  const out = { across: {}, down: {} };
  for (const dw of derived) {
    const ans = dw.cells.map(({ r, c }) => norm.sol[r][c]).join("");
    const start = dw.cells[0].r + "," + dw.cells[0].c;
    let m = W.find(w => !w.used && w.dir === dw.dir && (w.row + "," + w.col) === start);
    if (!m) m = W.find(w => !w.used && w.dir === dw.dir && w.ans === ans);
    if (m) { m.used = true; if (m.clue) out[dw.dir][String(dw.num)] = m.clue; }
    dw._ans = ans;
  }

  // Eksik ipuçları (cevabı görünür → kolay doldurma).
  for (const dw of derived) {
    const t = out[dw.dir][String(dw.num)];
    if (!t || !t.trim())
      issues.push({ level: "info", msg: `Eksik ipucu: ${dw.num} ${dirTr(dw.dir)} (${dw._ans}).` });
  }

  return { solution: norm.sol.map(r => r.join("")), clues: out, issues, conflicts: conflicts.length };
}

/* =========================================================================
   İskeletten kurma (TERCİH EDİLEN nihai yol).
   Geometri GÜVENİLİR bir kaynaktan gelir: "skeleton" = her hücrenin cevap
   hücresi mi ('.') yoksa cevap-dışı mı ('#': ipucu/siyah/foto) olduğunu söyleyen
   ızgara (CV ile önerilir, insan düzeltir). LLM yalnızca içeriği verir
   ({answer, clue, dir}) — konum/koordinat KULLANILMAZ. Cevaplar iskeletin
   yuvalarına yön + uzunluk + okuma sırasına göre yerleştirilir; kesişim kontrolü
   tutarsız harfleri tam koordinatıyla işaretler. Geometri doğru olduğundan
   çakışmalar azdır ve insan yalnızca işaretli hücrede harf seçer / eksik ipucu yazar.
   ========================================================================= */
export function assembleFromSkeleton(input) {
  const issues = [];
  const dirTr = dir => dir === "across" ? "Soldan Sağa" : "Yukarıdan Aşağıya";
  const rawSkel = Array.isArray(input && input.skeleton) ? input.skeleton.map(r => String(r == null ? "" : r)) : [];
  if (!rawSkel.length)
    return { solution: [], clues: { across: {}, down: {} }, issues: [{ level: "error", msg: "İskelet (skeleton) yok." }], conflicts: 0 };

  // '#' = cevap-dışı hücre; başka her karakter = cevap hücresi ('.').
  const cols = Math.max(...rawSkel.map(r => r.length));
  const skel = rawSkel.map(r => r.padEnd(cols, "#").split("").map(ch => ch === "#" ? "#" : "."));
  const rows = skel.length;

  // İskeletten yuvaları (across/down kelime yerleri) türet.
  const { words: slots } = buildWords(skel, rows, cols);
  slots.forEach(s => { s.len = s.cells.length; });
  slots.sort((a, b) => a.cells[0].r - b.cells[0].r || a.cells[0].c - b.cells[0].c || (a.dir < b.dir ? -1 : 1));

  // LLM kelimelerini yöne göre havuzla.
  const norm = w => ({ ans: normAnswer(w && w.answer), clue: (w && w.clue != null ? String(w.clue) : "").trim(), dir: normDir(w && w.dir), used: false });
  const all = (Array.isArray(input.words) ? input.words : []).map(norm).filter(w => w.ans);
  const pools = { across: all.filter(w => w.dir === "across"), down: all.filter(w => w.dir === "down") };

  // Çözücü: bulmacanın artıklığını kullan. Her yuvanın adayları = aynı yön +
  // aynı uzunluktaki cevaplar. Önce TEK adaylı yuvaları yerleştir; her yerleşim
  // kesişen harfleri sabitler, bu da komşu yuvaların adaylarını daraltır — uzun
  // (benzersiz) kelimeler çapayı kurar, kısalar kesişimden çözülür.
  slots.forEach(s => { s.cand = pools[s.dir].filter(w => w.ans.length === s.len); });
  const fixed = {};
  const fits = (s, w) => s.cells.every((c, k) => { const f = fixed[c.r + "," + c.c]; return f == null || f === w.ans[k]; });
  const place = (s, w) => { w.used = true; s._ans = w.ans; s._clue = w.clue; s.cells.forEach((c, k) => { fixed[c.r + "," + c.c] = w.ans[k]; }); };
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of slots) {
      if (s._ans) continue;
      s.cand = s.cand.filter(w => !w.used && fits(s, w));
      if (s.cand.length === 1) { place(s, s.cand[0]); changed = true; }
    }
  }
  // Kalan belirsiz yuvalar: sabit harflere uyan ilk kullanılmamış adayı seç.
  for (const s of slots) {
    if (s._ans) continue;
    const w = s.cand.find(w => !w.used && fits(s, w));
    if (w) place(s, w);
  }

  // Izgarayı sabitlenen harflerden kur. Çözücü tutarsız harf yerleştirmediğinden
  // çakışma değil, "doldurulamadı" (boş) hücreler oluşur — insan bunları düzeltir.
  const blanks = [];
  const sol = [];
  for (let r = 0; r < rows; r++) {
    let row = "";
    for (let c = 0; c < cols; c++) {
      if (skel[r][c] === "#") { row += "#"; continue; }
      const f = fixed[r + "," + c];
      if (f == null) { row += "?"; blanks.push({ r, c }); }
      else row += f;
    }
    sol.push(row);
  }
  blanks.forEach(b => issues.push({ level: "warn", msg: `Otomatik doldurulamadı: satır ${b.r + 1}, sütun ${b.c + 1} — elle düzeltin (iskelet/okuma boşluğu).` }));

  // İpuçlarını yuva numarasına bağla; eksikleri işaretle.
  const out = { across: {}, down: {} };
  for (const s of slots) if (s._ans && s._clue) out[s.dir][String(s.num)] = s._clue;
  for (const s of slots) {
    const t = out[s.dir][String(s.num)];
    if (!t || !t.trim()) issues.push({ level: "info", msg: `Eksik ipucu: ${s.num} ${dirTr(s.dir)} (${s._ans || "?"}).` });
  }
  // Yuvaya yerleşmeyen fazladan cevaplar.
  ["across", "down"].forEach(d => pools[d].filter(w => !w.used).forEach(w =>
    issues.push({ level: "warn", msg: `Eşleşmeyen cevap: "${w.ans}" (${dirTr(d)}) — iskelette uygun boşluk yok.` })));

  return { solution: sol, clues: out, issues, conflicts: blanks.length };
}
