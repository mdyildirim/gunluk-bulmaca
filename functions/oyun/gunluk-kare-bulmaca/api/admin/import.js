import { json } from "../../../../_lib/http.js";
import { slotCatalogFromSolution } from "../../../../_lib/engine.js";
import {
  gridPrompt,
  slotCluesPrompt,
  wordsPrompt,
  extractArray,
  triplesToClues,
  slotPairsToClues
} from "../../../../_lib/import-prompt.js";

// Görselden bulmaca çıkarımı — İKİ gemini-3.5-flash çağrısı.
//   • CLUE çağrısı → ipucu metnini gridden türetilen slotlara bağlar
//     (normal/non-stream; ~60 sn, hızlı). Slot yoksa eski ipucu+cevap yedeği.
//   • GRID  çağrısı → ızgara taslağı (yalnızca withGrid).
//
// NEDEN AKIŞ (streaming): GRID medium ~245 sn sürer ve Cloudflare ~100 sn'de hem
// tarayıcı bağlantısını hem de bizim Gemini'ye giden alt-isteğimizi 524 ile keser.
// Çözüm: streamGenerateContent + includeThoughts → headers ~4 sn'de gelir, sonra
// "düşünce" tokenları ~2 sn'de bir akar (ölçüldü: en uzun sessizlik 3 sn). Akan
// baytlar bağlantıyı canlı tutar → 524 olmaz. Sunucu da tarayıcıya NDJSON ilerleme
// satırları yazarak istemci bacağını canlı tutar. İstemler _lib/import-prompt.js'te.
// responseMimeType json KULLANMIYORUZ (ızgara kalitesini bozuyor) — düz metin + extractArray.

const MODEL = "gemini-3.5-flash";
// thinkingLevel KÜÇÜK harf + duyarlı (minimal|low|medium|high); ayarlanmazsa "high".
//   • ızgara = low → ÖLÇÜLDÜ (scripts/grid-latency.mjs): medium ~245 sn sürüyor ve
//     TEK bir Cloudflare invocation'ı o kadar yaşayamıyor (worker akış ortasında
//     öldürülüyordu — 524 değil, ömür sınırı). low ~25 sn, boyut OK (medium boyutu
//     YANLIŞ veriyordu!), ~12× ucuz. Geometri yine taslak (orta sütunlar seyrek).
//     minimal işe yaramıyor (3 sn ama boyut bozuk, ipucu kelimesini hücreye yazıyor).
//   • kelime = low → medium EK doğruluk getirmiyor, ~200 sn sürüp 524 yapıyordu; low ~60 sn.
const GRID_THINKING = "low";
const WORDS_THINKING = "low";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const STREAM_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;            // ~8 MB (çözümlenmiş)
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// gemini-3.5-flash gerçek fiyatı ($/1M token), kullanıcı tarafından verildi. Token
// sayısı Gemini usageMetadata'dan GERÇEK; dolar = token × oran. "Düşünme" tokenları
// çıktı gibi faturalanır.
const PRICE_IN_PER_M = 1.5;
const PRICE_OUT_PER_M = 9;
const sumUsage = (a, b) => ({
  promptTokenCount: (a.promptTokenCount || 0) + (b.promptTokenCount || 0),
  candidatesTokenCount: (a.candidatesTokenCount || 0) + (b.candidatesTokenCount || 0),
  thoughtsTokenCount: (a.thoughtsTokenCount || 0) + (b.thoughtsTokenCount || 0),
  totalTokenCount: (a.totalTokenCount || 0) + (b.totalTokenCount || 0)
});
const costUsd = u => (PRICE_IN_PER_M == null || PRICE_OUT_PER_M == null) ? null
  : ((u.promptTokenCount || 0) / 1e6) * PRICE_IN_PER_M
    + (((u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)) / 1e6) * PRICE_OUT_PER_M;

const bodyFor = (prompt, mimeType, imageBase64, thinking) => JSON.stringify({
  contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }] }],
  generationConfig: { temperature: 0, thinkingConfig: { thinkingLevel: thinking, includeThoughts: true } }
});

function cleanSlots(slots) {
  return (Array.isArray(slots) ? slots : [])
    .map(s => ({
      id: String(s && s.id || "").trim().toUpperCase(),
      dir: s && s.dir === "down" ? "down" : "across",
      answer: String(s && s.answer || "").trim().toLocaleUpperCase("tr-TR")
    }))
    .filter(s => /^[AD]\d+$/.test(s.id) && s.answer);
}

const slotsFromSolution = solution => cleanSlots(slotCatalogFromSolution(solution));

// --- WORDS: normal (non-stream) çağrı → { text, usage } ---
async function geminiText(key, prompt, mimeType, imageBase64, thinking) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: bodyFor(prompt, mimeType, imageBase64, thinking)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => null);
  const usage = (data && data.usageMetadata) || {};
  const text = (data && data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts || [])
    .map(p => p && !p.thought && p.text).filter(Boolean).join("");
  if (!text) { const e = new Error("Gemini boş yanıt döndürdü."); e.usage = usage; throw e; }
  return { text, usage };
}

// Flash bazen sayıklayıp diziyi yazmaz; bir kez yeniden dener. Token tüketimi toplanır.
async function geminiArray(key, prompt, mimeType, imageBase64, thinking) {
  let lastErr, usage = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text, usage: u } = await geminiText(key, prompt, mimeType, imageBase64, thinking);
      usage = sumUsage(usage, u);
      return { array: extractArray(text), usage };
    } catch (e) { lastErr = e; if (e && e.usage) usage = sumUsage(usage, e.usage); }
  }
  lastErr.usage = usage;
  throw lastErr;
}

async function geminiClues(key, slots, mimeType, imageBase64) {
  if (slots && slots.length) {
    const r = await geminiArray(key, slotCluesPrompt(slots), mimeType, imageBase64, WORDS_THINKING);
    return { words: slotPairsToClues(r.array, slots), usage: r.usage };
  }
  const r = await geminiArray(key, wordsPrompt, mimeType, imageBase64, WORDS_THINKING);
  return { words: triplesToClues(r.array), usage: r.usage };
}

// --- GRID: AKIŞ çağrısı. SSE'yi okur, "düşünce" parçaları bağlantıyı canlı tutar,
// cevap parçaları biriktirilir. onProgress(sec, thoughtTokens) ~saniyede bir çağrılır.
// → { array, usage }. extractArray hatasında usage hataya iliştirilir. ---
async function streamGridOnce(key, prompt, mimeType, imageBase64, onProgress) {
  const res = await fetch(STREAM_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: bodyFor(prompt, mimeType, imageBase64, GRID_THINKING)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", answer = "", usage = {}, t0 = Date.now(), lastPing = -1;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        for (const p of (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [])
          if (p && p.text && !p.thought) answer += p.text;
        if (j.usageMetadata) usage = j.usageMetadata;
      } catch { /* kısmi satır olmamalı (SSE tam yollar) */ }
    }
    const sec = Math.round((Date.now() - t0) / 1000);
    if (onProgress && sec !== lastPing) { lastPing = sec; onProgress(sec, usage.thoughtsTokenCount || 0); }
  }
  try { return { array: extractArray(answer), usage }; }
  catch (e) { e.usage = usage; throw e; }
}

async function streamGrid(key, prompt, mimeType, imageBase64, onProgress) {
  let lastErr, usage = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await streamGridOnce(key, prompt, mimeType, imageBase64, onProgress);
      return { array: r.array, usage: sumUsage(usage, r.usage) };
    } catch (e) { lastErr = e; if (e && e.usage) usage = sumUsage(usage, e.usage); }
  }
  lastErr.usage = usage;
  throw lastErr;
}

// İki çağrının sonucundan tek yanıt nesnesi (JSON yolu ve akış "result" satırı ortak).
function assembleResult(wRes, gRes, withGrid) {
  const usageOf = r => r.status === "fulfilled" ? (r.value && r.value.usage) || {} : (r.reason && r.reason.usage) || {};
  const wUsage = usageOf(wRes);
  const gUsage = withGrid ? usageOf(gRes) : null;
  const total = sumUsage(wUsage, gUsage || {});
  const usage = { words: wUsage, grid: gUsage, total };
  const cost = {
    usd: costUsd(total), words: costUsd(wUsage), grid: gUsage ? costUsd(gUsage) : 0,
    rateInPerM: PRICE_IN_PER_M, rateOutPerM: PRICE_OUT_PER_M
  };
  if (wRes.status === "rejected")
    return { ok: false, error: "İpuçları okunamadı.",
      detail: String(wRes.reason && wRes.reason.message || wRes.reason).slice(0, 300), usage, cost };
  const words = wRes.value.words || triplesToClues(wRes.value.array);
  let grid = null, gridError = null;
  if (withGrid) {
    if (gRes.status === "fulfilled" && gRes.value && Array.isArray(gRes.value.array))
      grid = gRes.value.array.map(r => String(r));
    else gridError = String(gRes.reason && gRes.reason.message || gRes.reason || "Izgara okunamadı.").slice(0, 200);
  }
  return { ok: true, model: MODEL, words, grid, gridError, usage, cost };
}

export const onRequestPost = async ({ env, request, waitUntil }) => {
  const key = env.GEMINI_API_KEY;
  if (!key) return json({ ok: false, error: "GEMINI_API_KEY tanımlı değil." }, 503);

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Geçersiz JSON." }, 400); }

  const imageBase64 = body && body.imageBase64;
  const mimeType = body && body.mimeType;
  if (!imageBase64 || typeof imageBase64 !== "string")
    return json({ ok: false, error: "Görsel verisi (imageBase64) yok." }, 400);
  if (!ALLOWED_MIME.has(mimeType))
    return json({ ok: false, error: "Desteklenmeyen görsel türü (JPEG/PNG/WebP/GIF)." }, 400);
  if (imageBase64.length > MAX_IMAGE_BYTES * 1.4)
    return json({ ok: false, error: "Görsel çok büyük (≈8 MB sınırı)." }, 413);

  const withGrid = !!(body && body.withGrid);
  const toDim = v => { const n = Math.trunc(Number(v)); return n >= 1 && n <= 50 ? n : null; };
  const rows = toDim(body && body.rows), cols = toDim(body && body.cols);
  const requestSlots = cleanSlots(body && body.slots);

  // --- Yalnızca ipuçları: hızlı (~60 sn < 100 sn) → düz JSON yanıt. ---
  if (!withGrid) {
    const wRes = await Promise.allSettled([geminiClues(key, requestSlots, mimeType, imageBase64)]).then(a => a[0]);
    const result = assembleResult(wRes, { status: "fulfilled", value: null }, false);
    return json(result, result.ok ? 200 : 502, { "cache-control": "no-store" });
  }

  // --- Izgara da istendi: GRID uzun sürer → AKIŞ (NDJSON). Her satır bir JSON nesnesi:
  //   {t:"progress",sec,think}  · ara ara, bağlantıyı canlı tutar
  //   {t:"result", ...assembleResult}  · sonda bir kez
  //   {t:"error", error}  · ölümcül hata
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const writeLine = o => writer.write(enc.encode(JSON.stringify(o) + "\n")).catch(() => {});

  const log = (...a) => { try { console.log("[import]", ...a); } catch {} };
  const pump = (async () => {
    try {
      log("pump start", JSON.stringify({ rows, cols }));
      const gridP = streamGrid(key, gridPrompt(rows, cols), mimeType, imageBase64,
        (sec, think) => { if (sec % 15 === 0) log("grid akıyor", sec + "s", think + " düşünce-tok"); return writeLine({ t: "progress", sec, think }); });
      const gRes = await Promise.allSettled([gridP]).then(a => a[0]);
      let wRes;
      if (gRes.status === "fulfilled") {
        const gridRows = (gRes.value.array || []).map(r => String(r));
        const slots = slotsFromSolution(gridRows);
        await writeLine({ t: "grid", count: slots.length, grid: gridRows });
        await writeLine({ t: "progress", phase: "words", count: slots.length });
        wRes = await Promise.allSettled([geminiClues(key, slots, mimeType, imageBase64)]).then(a => a[0]);
        if (wRes.status === "fulfilled") {
          log("slot clues OK n=", wRes.value.words.length, "slots=", slots.length);
          await writeLine({ t: "words", ok: true, words: wRes.value.words });
        } else log("slot clues FAIL", String(wRes.reason && wRes.reason.message || wRes.reason));
      } else {
        wRes = { status: "rejected", reason: new Error("Izgara okunamadığı için slot kataloğu çıkarılamadı.") };
      }
      log("ikisi de bitti words=" + wRes.status, "grid=" + gRes.status,
        gRes.status === "rejected" ? "gridErr=" + String(gRes.reason && gRes.reason.message).slice(0, 120)
          : "gridRows=" + (gRes.value && gRes.value.array && gRes.value.array.length));
      await writeLine({ t: "result", ...assembleResult(wRes, gRes, true) });
      log("result yazildi");
    } catch (e) {
      log("PUMP HATA", String(e && e.message || e));
      await writeLine({ t: "error", error: String(e && e.message || e).slice(0, 300) });
    } finally {
      log("kapaniyor");
      await writer.close().catch(() => {});
    }
  })();
  if (waitUntil) waitUntil(pump);

  return new Response(readable, {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" }
  });
};
