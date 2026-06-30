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
    ? `Return ${rows} strings, each exactly ${cols} characters.`
    : `Return one string per row; all strings must have the same length.`;
  return `Extract the solved crossword grid from the image.

${dims}

For each physical cell, output:
- the uppercase Turkish letter if the cell contains exactly one large answer letter
- "#" for anything else: clue text, arrows, photo, black/empty cells

Output only a JSON array of strings.`;
}

// --- 2A) Tercih edilen yol: slot kataloğuna ipucu bağlama --------------------
// Grid eldeyse cevapları LLM'den istemeyiz. Cevaplar zaten griddeki slotlardan
// gelir; model yalnızca fotoğraftaki basılı ipucu + ok ile doğru slot ID'sini
// eşleştirir.
export function slotCluesPrompt(slots) {
  const catalog = (Array.isArray(slots) ? slots : [])
    .map(s => {
      const pos = s.row && s.col ? ` r${s.row}c${s.col}` : "";
      return `${s.id} ${s.dir === "down" ? "DOWN" : "ACROSS"} ${s.answer}${pos}`;
    })
    .join("\n");
  return `Extract clue-slot pairs from the image.

Slots:
${catalog}

Follow each clue arrow to one slot. Output one [SLOT_ID, CLUE] per clue.
Use only listed slot IDs. Use "?" only when the arrow target is unreadable.
Preserve printed clue text; collapse line breaks.

Output only JSON, like [["A9","Bilgisizlik"],["D1","İnce, yassı elmas"]].`;
}

// --- 2B) Yedek yol: grid/slot yoksa eski serbest cevap istemi ----------------
// Bu yol daha riskli: model bazen cevabı görselden okumak yerine ipucundan çözer.
// Admin mümkün olduğunca slotCluesPrompt kullanır.
export const wordsPrompt = `Extract all clue-answer pairs from this solved Turkish arrow crossword image.

For each clue, follow its arrow and return [ANSWER, DIR, CLUE].
- ANSWER: visible answer letters only
- DIR: "a" for across, "d" for down
- CLUE: printed clue text

Output only a JSON array.`;

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
      if (Array.isArray(item)) {
        slot = item[0];
        clue = item.length >= 3 ? item[item.length - 1] : item[1];
      }
      else if (item && typeof item === "object") {
        slot = item.slot ?? item.slot_id ?? item.slotId ?? item.id ?? item.SLOT_ID;
        clue = item.clue ?? item.hint ?? item.ipucu ?? item.text ?? item.CLUE;
      }
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
