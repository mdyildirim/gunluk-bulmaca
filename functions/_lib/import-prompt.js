// Görselden bulmaca çıkarımı — İKİ AYRI gemini-3.5-flash çağrısının ORTAK istemleri
// + ayrıştırıcıları. Tek kaynak: hem Pages Function (import.js) hem deney betikleri
// (scripts/*.mjs) buradan okur; kopya kayması olmaz (geçmişte bu drift bizi ısırdı).
//
// MİMARİ (Haziran 2026 deneyleriyle doğrulandı — bkz. scripts/two-call-test.mjs):
// TEK birleşik çağrı yerine iki ayrı, kısa görev daha iyi:
//   1) GRID çağrısı → SADECE ızgara: N satır × M karakterlik düz JSON dizisi.
//   2) CLUE çağrısı → mümkünse hazır ızgaradan türetilen SLOT kataloğuna ipucu
//      metni bağlar. Bu, modelin "cevabı" sözlükten çözmesini engeller: cevap
//      serbest metin değil, yalnızca griddeki slot ID'sidir.
//
// KRİTİK: Gemini'de responseMimeType:"application/json" KULLANMA — bu çağrılarda
// ızgara kalitesini yarıya düşürüp gecikmeyi ikiye katlıyor. Düz metin iste, çitleri
// ayıkla, ilk '[' ile son ']' arasını çöz (extractArray).

// --- 1) IZGARA istemi -------------------------------------------------------
// Sabit genişlik dayatılır: modelin en büyük zaafı satır başına hücre SAYISINI
// tutarlı tutmaktır; boyut bilinince bu serbestlik kalkar. Boyut verilmezse yalnızca
// "her satır eşit uzunlukta" denir (hizalama daha sık kayar).
export function gridPrompt(rows, cols) {
  const dims = (rows && cols)
    ? `Output ONLY a JSON array of ${rows} strings (top→bottom), each EXACTLY ${cols} characters long — the grid is ${cols} columns wide × ${rows} rows tall. Never output more or fewer than ${rows} rows, and never more or fewer than ${cols} characters in a row.`
    : `Output ONLY a JSON array of strings, one per row top→bottom. EVERY string must be the SAME length (exactly one character per cell).`;
  return `Photo of a SOLVED Turkish arrow crossword ("kare bulmaca"). Reconstruct the filled grid, cell by cell.

${dims}

This is a Turkish arrow-style crossword: some cells hold the printed clues (one or two clue texts plus a direction arrow) instead of a letter. Each character of your output is either:
- one UPPERCASE Turkish letter (A-Z plus Ç Ğ İ I Ö Ş Ü) for an answer cell (a cell filled with a solution letter), or
- '#' for any non-answer cell — a clue cell (printed clue text + arrows), the photo block, or a black square. These never hold a puzzle letter.

If a row has fewer answer cells than its width, fill the leftover cells with '#'. NEVER repeat or invent a letter just to fill a row to the right length.

Turkish has two capital I's — dotless 'I' and dotted 'İ'. Keep them distinct: a dot counts only if it clearly sits on the letter body; arrows or hint marks near a cell are NOT dots.

Across answers read left→right and down answers read top→bottom, so every crossing letter must agree in both directions. Count cells carefully across the photo block.

Output ONLY the JSON array — no explanation, no reasoning, no other text. Start your answer with '[' and end with ']'.`;
}

// --- 2A) Tercih edilen yol: slot kataloğuna ipucu bağlama --------------------
// Grid eldeyse cevapları LLM'den istemeyiz. Cevaplar zaten griddeki slotlardan
// gelir; model yalnızca fotoğraftaki basılı ipucu + ok ile doğru slot ID'sini
// eşleştirir.
export function slotCluesPrompt(slots) {
  const catalog = (Array.isArray(slots) ? slots : [])
    .map(s => `${s.id}: ${s.dir === "down" ? "DOWN" : "ACROSS"} ${s.answer} (${String(s.answer || "").length})`)
    .join("\n");
  return `This is a photo of a SOLVED Turkish arrow-style crossword ("kare bulmaca" / İsveç bulmaca).

The solved answer grid has ALREADY been extracted. Do NOT solve clues from general knowledge and do NOT invent answers. Your job is only to read the printed clue text in the photo and assign each clue to one of the known answer slots below by following the clue arrow visually.

KNOWN ANSWER SLOTS FROM THE GRID:
${catalog}

Rules:
- Every printed clue is inside a clue cell; one cell can contain two separate clues.
- Follow the arrow from the clue cell to the answer run, then choose the matching SLOT ID from the catalog.
- Use ONLY SLOT IDs from the catalog. Never output an answer word.
- If you can read a clue but cannot confidently attach it to a catalog slot, use "?" as the slot id.
- Do not choose a slot just because the clue definition semantically matches an answer. The answer must be the visual target of the arrow.
- Preserve clue text as printed. Rejoin words split across lines by a hyphen and collapse line breaks to single spaces. For a photo clue, identify who/what it shows.

Output ONLY a JSON array where each item is [SLOT_ID, CLUE]. Example:
[["A9","Bilgisizlik"],["D1","İnce, yassı elmas"]]

Output no explanation, no reasoning, no other text. Start with '[' and end with ']'.`;
}

// --- 2B) Yedek yol: grid/slot yoksa eski serbest cevap istemi ----------------
// Bu yol daha riskli: model bazen cevabı görselden okumak yerine ipucundan çözer.
// Admin mümkün olduğunca slotCluesPrompt kullanır.
export const wordsPrompt = `This is a photo of a SOLVED Turkish arrow-style crossword ("kare bulmaca" / İsveç bulmaca).

HOW THE PUZZLE IS BUILT — read this carefully before answering:
- There is NO separate numbered clue list. Each clue is PRINTED INSIDE a small grid cell (a "clue cell").
- A single clue cell can hold ONE clue or TWO clues (an upper clue and a lower clue stacked in the same cell). Two clues in a cell = two separate answers.
- Every clue has an ARROW that shows where ITS answer begins and which way it runs:
  • arrow pointing right (→) → the answer reads LEFT→RIGHT (across), starting in the cell the arrow points into;
  • arrow pointing down (↓) → the answer reads TOP→BOTTOM (down);
  • a bent / elbow arrow first steps one cell over and then turns — use its FINAL direction as the answer's direction.
  A clue cell with two clues usually sends one arrow right and one arrow down.
- The answer is the run of filled-in letters in the arrow's direction, continuing until the next clue cell, a black square, or the grid edge.
- A photo printed inside the grid is itself a clue; its arrow points to the answer.

List EVERY clue→answer pair (don't merge stacked clues, don't skip any). Output ONLY a JSON array where each item is a 3-element array [ANSWER, DIR, CLUE]:
- ANSWER = the filled-in letters of that answer, UPPERCASE Turkish (A-Z plus Ç Ğ İ I Ö Ş Ü), no spaces or punctuation.
- DIR = "a" if the answer reads left→right, "d" if it reads top→bottom.
- CLUE = the clue text exactly as printed. Rejoin words split across lines by a hyphen into one (e.g. "Deniz taşı-\\nmacılığı" → "Deniz taşımacılığı") and collapse line breaks to single spaces; otherwise keep the wording verbatim. For a photo clue, identify who/what it shows (e.g. "Fotoğraftaki kişi (…)").

Output ONLY the JSON array — no explanation, no reasoning, no other text. Start your answer with '[' and end with ']'.`;

// --- Ayrıştırıcılar ---------------------------------------------------------
const stripFences = s => {
  const m = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  return (m ? m[1] : s).trim();
};

// Düz metin yanıttan JSON diziyi çöz: önce doğrudan, olmazsa ilk '[' … son ']' arası.
// (Flash bazen diziyi tırnaklı string olarak da sarar; bir kez daha çözeriz.)
export function extractArray(text) {
  const s = stripFences(text || "");
  try { let o = JSON.parse(s); if (typeof o === "string") o = JSON.parse(o); return o; } catch { /* dene */ }
  const i = s.indexOf("["), j = s.lastIndexOf("]");
  if (i >= 0 && j > i) { let o = JSON.parse(s.slice(i, j + 1)); if (typeof o === "string") o = JSON.parse(o); return o; }
  throw new Error("Yanıtta JSON dizi yok: " + s.slice(0, 80));
}

// WORDS üçlülerini reconcileImport'un beklediği {answer,clue,dir} biçimine çevir.
export function triplesToClues(arr) {
  return (Array.isArray(arr) ? arr : [])
    .filter(t => Array.isArray(t) && t.length >= 3)
    .map(([answer, dir, clue]) => ({
      answer: String(answer == null ? "" : answer),
      clue: String(clue == null ? "" : clue),
      dir: String(dir).toLowerCase().startsWith("d") ? "down" : "across"
    }));
}

const cleanSlotId = id => String(id == null ? "" : id).trim().toUpperCase()
  .replace(/\s+/g, "")
  .replace(/^ACROSS:?/, "A")
  .replace(/^DOWN:?/, "D")
  .replace(/^A:/, "A")
  .replace(/^D:/, "D");

// SLOT çıktısını reconcileImport'un beklediği {slot,answer,clue,dir} biçimine çevir.
export function slotPairsToClues(arr, slots) {
  const byId = new Map((Array.isArray(slots) ? slots : [])
    .map(s => [cleanSlotId(s.id), {
      slot: cleanSlotId(s.id),
      answer: String(s.answer == null ? "" : s.answer),
      dir: s.dir === "down" ? "down" : "across"
    }]));
  return (Array.isArray(arr) ? arr : [])
    .map(item => {
      let slot, clue;
      if (Array.isArray(item)) [slot, clue] = item;
      else if (item && typeof item === "object") ({ slot, clue } = item);
      else return null;
      const rawSlot = cleanSlotId(slot);
      const s = byId.get(rawSlot);
      if (!s) return {
        slot: rawSlot || "?",
        answer: "",
        dir: "across",
        clue: String(clue == null ? "" : clue),
        unmatchedSlot: true
      };
      return { ...s, clue: String(clue == null ? "" : clue) };
    })
    .filter(Boolean);
}
