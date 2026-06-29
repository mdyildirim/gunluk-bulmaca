// reconcileImport birim testi (LLM çıktısı → editör biçimi + sorunlar).
// Çalıştır: node scripts/test-reconcile.mjs
import assert from "node:assert/strict";
import { reconcileImport, reconcileWords, assembleFromSkeleton, slotCatalogFromSolution } from "../public/oyun/gunluk-kare-bulmaca/shared/engine.js";
import { slotPairsToClues } from "../functions/_lib/import-prompt.js";

// Izgara (seed ile aynı): türetilen kelimeler
//   Soldan Sağa: 1 TAM, 3 AY, 5 KASA, 7 KAR
//   Yukarıdan Aşağıya: 1 TEK, 2 MASA, 4 YAR, 6 AK
const grid = ["TAM#", "E#AY", "KASA", "#KAR"];

const llm = {
  grid,
  clues: [
    { answer: "tam",  clue: "Eksiksiz",    dir: "soldan sağa" }, // küçük harf + TR yön
    { answer: "AY",   clue: "Gökyüzü",     dir: "across" },
    { answer: "KASA", clue: "Para kutusu", dir: "across" },
    // 7 KAR (Soldan Sağa) bilerek eksik → "Eksik ipucu" info beklenir
    { answer: "TEK",  clue: "Yalnız",      dir: "down" },
    { answer: "MASA", clue: "Mobilya",     dir: "aşağı" },        // TR yön → down
    { answer: "YAR",  clue: "Uçurum",      dir: "down" },
    { answer: "AK",   clue: "Beyaz",       dir: "down" },
    { answer: "TEM",  clue: "Yanlış okunmuş", dir: "down" }       // eşleşmeyen → warn
  ]
};

const r = reconcileImport(llm);

// 1) Izgara normalize edilip aynen korunur.
assert.deepEqual(r.solution, ["TAM#", "E#AY", "KASA", "#KAR"], "solution");

// 2) İpuçları doğru numaralara bağlanır.
assert.deepEqual(r.clues.across, { "1": "Eksiksiz", "3": "Gökyüzü", "5": "Para kutusu" }, "across");
assert.deepEqual(r.clues.down,   { "1": "Yalnız", "2": "Mobilya", "4": "Uçurum", "6": "Beyaz" }, "down");

// 3) Sorunlar: eşleşmeyen "TEM" (warn) + eksik 7 KAR (info).
const warns = r.issues.filter(i => i.level === "warn");
const infos = r.issues.filter(i => i.level === "info");
assert.ok(warns.some(i => i.msg.includes("TEM")), "eşleşmeyen ipucu uyarısı");
assert.ok(infos.some(i => i.msg.includes("KAR") && i.msg.includes("7")), "eksik ipucu (7 KAR)");
assert.equal(infos.length, 1, "yalnızca 1 eksik ipucu");

// 4) Yanlış okunan harf senaryosu: ızgarada 'O' yazıp clue answer 'TAM' verilirse
//    eşleşmez (warn) ve 1 Soldan Sağa eksik kalır.
const r2 = reconcileImport({
  grid: ["TOM#", "E#AY", "KASA", "#KAR"], // T-O-M (yanlış okuma)
  clues: [{ answer: "TAM", clue: "Eksiksiz", dir: "across" }]
});
assert.ok(r2.issues.some(i => i.level === "warn" && i.msg.includes("TAM")), "misread → eşleşmeyen");

// 5) Eşit olmayan satır uzunluğu uyarısı.
const r3 = reconcileImport({ grid: ["TAM", "E#AY"], clues: [] });
assert.ok(r3.issues.some(i => i.msg.includes("eşit değil")), "satır hizalama uyarısı");

// 6) Slot ID varsa cevap metni serbest doğrulama değildir; slot ızgaradaki kelimeye
//    bağlanır. Böylece LLM'in ipucundan uydurduğu answer alanı ipucunu düşürmez.
const slots = slotCatalogFromSolution(grid);
const slotClues = slotPairsToClues([["A1", "Eksiksiz"], ["D999", "Olmayan slot"]], slots);
const r4 = reconcileImport({
  grid,
  clues: slotClues.concat([{ slot: "A3", answer: "KÜTİKÜL", dir: "across", clue: "Gökyüzü" }])
});
assert.equal(r4.clues.across["1"], "Eksiksiz", "slot A1 bağlandı");
assert.equal(r4.clues.across["3"], "Gökyüzü", "slot answer alanına üstün geldi");
assert.ok(r4.issues.some(i => i.level === "warn" && i.msg.includes("D999")), "olmayan slot uyarısı");

console.log("✓ reconcileImport: tüm testler geçti");

// ----------------------------------------------------------------------------
// reconcileWords: kelime listesinden ızgara kurma + kesişim çakışması tespiti.
// Aynı seed bulmacası, kelimeler {answer,clue,dir,row,col} olarak verilir.
const words = [
  { answer: "TAM",  clue: "Eksiksiz",    dir: "across", row: 0, col: 0 },
  { answer: "AY",   clue: "Gök cismi",   dir: "across", row: 1, col: 2 },
  { answer: "KASA", clue: "Para kutusu", dir: "across", row: 2, col: 0 },
  { answer: "KAR",  clue: "",            dir: "across", row: 3, col: 1 }, // eksik ipucu
  { answer: "TEK",  clue: "Yalnız",      dir: "down",   row: 0, col: 0 },
  { answer: "MOSA", clue: "Mobilya",     dir: "down",   row: 0, col: 2 }, // (1,2) 'O' ≠ across 'A' → çakışma
  { answer: "YAR",  clue: "Sevgili",     dir: "down",   row: 1, col: 3 },
  { answer: "AK",   clue: "Beyaz",       dir: "down",   row: 2, col: 1 }
];
const rw = reconcileWords({ rows: 4, cols: 4, words });

// 1) Izgara kelimelerden doğru kurulur (çakışan hücrede yatay harf seçilir).
assert.deepEqual(rw.solution, ["TAM#", "E#AY", "KASA", "#KAR"], "reconcileWords solution");

// 2) Tam bir kesişim çakışması işaretlenir (satır 2, sütun 3).
assert.equal(rw.conflicts, 1, "tek çakışma");
assert.ok(rw.issues.some(i => i.level === "warn" && i.msg.includes("Harf çakışması") && i.msg.includes("satır 2, sütun 3")),
  "çakışma koordinatıyla işaretlendi");

// 3) İpuçları doğru numaralara bağlanır; eksik olan (KAR) işaretlenir.
assert.deepEqual(rw.clues.across, { "1": "Eksiksiz", "3": "Gök cismi", "5": "Para kutusu" }, "rw across");
assert.deepEqual(rw.clues.down,   { "1": "Yalnız", "2": "Mobilya", "4": "Sevgili", "6": "Beyaz" }, "rw down");
assert.ok(rw.issues.some(i => i.level === "info" && i.msg.includes("KAR")), "eksik ipucu (KAR)");

// 4) rows/cols verilmese de kelime uçlarından türetilir.
const rw2 = reconcileWords({ words });
assert.ok(rw2.solution.length === 4, "boyut otomatik türetildi");

console.log("✓ reconcileWords: tüm testler geçti");

// ----------------------------------------------------------------------------
// assembleFromSkeleton: güvenilir iskelet + LLM cevap listesi → kurulan ızgara.
// İskelet ('.'=cevap hücresi, '#'=cevap-dışı) seed bulmacasının şekli.
const skeleton = ["...#", ".#..", "....", "#..."];
// LLM kelimeleri (KONUM YOK — yalnızca answer/clue/dir):
const llmWords = [
  { answer: "TAM",  clue: "Eksiksiz",    dir: "across" },
  { answer: "AY",   clue: "Gök cismi",   dir: "across" },
  { answer: "KASA", clue: "Para kutusu", dir: "across" },
  { answer: "KAR",  clue: "",            dir: "across" }, // eksik ipucu (bilerek boş)
  { answer: "TEK",  clue: "Yalnız",      dir: "down" },
  { answer: "MASA", clue: "Mobilya",     dir: "down" },
  { answer: "YAR",  clue: "Sevgili",     dir: "down" },
  { answer: "AK",   clue: "Beyaz",       dir: "down" }
];
const as = assembleFromSkeleton({ skeleton, words: llmWords });

// 1) Çözücü ızgarayı kesişimlerden doğru kurar — konum bilgisi olmadan.
assert.deepEqual(as.solution, ["TAM#", "E#AY", "KASA", "#KAR"], "assemble solution");
// 2) Tutarlı çözümde doldurulamayan hücre yok.
assert.equal(as.conflicts, 0, "assemble boş hücre yok");
// 3) İpuçları numaralara bağlanır; boş bırakılan (KAR) işaretlenir.
assert.deepEqual(as.clues.across, { "1": "Eksiksiz", "3": "Gök cismi", "5": "Para kutusu" }, "assemble across");
assert.deepEqual(as.clues.down,   { "1": "Yalnız", "2": "Mobilya", "4": "Sevgili", "6": "Beyaz" }, "assemble down");
assert.ok(as.issues.some(i => i.level === "info" && i.msg.includes("KAR")), "assemble eksik ipucu (KAR)");

// 4) Fazladan/uyumsuz cevap çözücüde yerleştirilemez → "eşleşmeyen" olarak işaretlenir.
const as2 = assembleFromSkeleton({ skeleton, words: llmWords.concat([{ answer: "ZZZZ", clue: "Sahte", dir: "across" }]) });
assert.deepEqual(as2.solution, ["TAM#", "E#AY", "KASA", "#KAR"], "fazladan cevap ızgarayı bozmaz");
assert.ok(as2.issues.some(i => i.level === "warn" && i.msg.includes("ZZZZ")), "fazladan cevap işaretlendi");

console.log("✓ assembleFromSkeleton: tüm testler geçti");
