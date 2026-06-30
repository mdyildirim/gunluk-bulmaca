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

// Görselden bulmaca çıkarımı — sağlayıcı başına İKİ görsel çağrısı.
//   • CLUE çağrısı → ipucu metnini gridden türetilen slotlara bağlar
//     (stream; medium uzun sürerse 524 yememek için). Slot yoksa eski ipucu+cevap yedeği.
//   • GRID  çağrısı → ızgara taslağı (yalnızca withGrid).
//
// NEDEN AKIŞ (streaming): GRID medium ~245 sn sürer ve Cloudflare ~100 sn'de hem
// tarayıcı bağlantısını hem de bizim Gemini'ye giden alt-isteğimizi 524 ile keser.
// Çözüm: streamGenerateContent + includeThoughts → headers ~4 sn'de gelir, sonra
// "düşünce" tokenları ~2 sn'de bir akar (ölçüldü: en uzun sessizlik 3 sn). Akan
// baytlar bağlantıyı canlı tutar → 524 olmaz. Sunucu da tarayıcıya NDJSON ilerleme
// satırları yazarak istemci bacağını canlı tutar. İstemler _lib/import-prompt.js'te.
// responseMimeType json KULLANMIYORUZ (ızgara kalitesini bozuyor) — düz metin + extractArray.

const DEFAULT_PROVIDER = "gemini";
const GEMINI_MODEL = "gemini-3.5-flash";
const OPENAI_MODEL = "gpt-5.5";
// thinkingLevel KÜÇÜK harf + duyarlı (minimal|low|medium|high); ayarlanmazsa "high".
//   • ızgara = low → ÖLÇÜLDÜ (scripts/grid-latency.mjs): medium ~245 sn sürüyor ve
//     TEK bir Cloudflare invocation'ı o kadar yaşayamıyor (worker akış ortasında
//     öldürülüyordu — 524 değil, ömür sınırı). low ~25 sn, boyut OK (medium boyutu
//     YANLIŞ veriyordu!), ~12× ucuz. Geometri yine taslak (orta sütunlar seyrek).
//     minimal işe yaramıyor (3 sn ama boyut bozuk, ipucu kelimesini hücreye yazıyor).
//   • kelime = low → medium EK doğruluk getirmiyor, ~200 sn sürüp 524 yapıyordu; low ~60 sn.
const PROVIDERS = {
  gemini: {
    envName: "GEMINI_API_KEY",
    model: GEMINI_MODEL,
    defaultGridThinking: "low",
    defaultClueThinking: "low",
    thinkingLevels: new Set(["minimal", "low", "medium", "high"]),
    priceInPerM: 1.5,
    priceOutPerM: 9
  },
  openai: {
    envName: "OPENAI_API_KEY",
    model: OPENAI_MODEL,
    defaultGridThinking: "high",
    defaultClueThinking: "high",
    thinkingLevels: new Set(["low", "medium", "high", "xhigh"]),
    priceInPerM: null,
    priceOutPerM: null
  }
};
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_STREAM_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;
const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;            // ~8 MB (çözümlenmiş)
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const sumUsage = (a, b) => ({
  promptTokenCount: (a.promptTokenCount || 0) + (b.promptTokenCount || 0),
  candidatesTokenCount: (a.candidatesTokenCount || 0) + (b.candidatesTokenCount || 0),
  thoughtsTokenCount: (a.thoughtsTokenCount || 0) + (b.thoughtsTokenCount || 0),
  totalTokenCount: (a.totalTokenCount || 0) + (b.totalTokenCount || 0)
});
const costUsd = (u, cfg) => (!cfg || cfg.priceInPerM == null || cfg.priceOutPerM == null) ? null
  : ((u.promptTokenCount || 0) / 1e6) * cfg.priceInPerM
    + (((u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)) / 1e6) * cfg.priceOutPerM;

const geminiBodyFor = (prompt, mimeType, imageBase64, thinking) => JSON.stringify({
  contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }] }],
  generationConfig: { temperature: 0, thinkingConfig: { thinkingLevel: thinking, includeThoughts: true } }
});

const openaiBodyFor = (prompt, mimeType, imageBase64, thinking, stream) => JSON.stringify({
  model: OPENAI_MODEL,
  input: [{
    role: "user",
    content: [
      { type: "input_text", text: prompt },
      { type: "input_image", image_url: `data:${mimeType};base64,${imageBase64}`, detail: "original" }
    ]
  }],
  reasoning: { effort: thinking },
  text: { format: { type: "text" } },
  store: false,
  stream: !!stream
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
const providerName = value => {
  const v = String(value || "").trim().toLowerCase();
  return PROVIDERS[v] ? v : DEFAULT_PROVIDER;
};
const thinkingLevel = (value, fallback, levels) => {
  const v = String(value || "").trim().toLowerCase();
  return levels.has(v) ? v : fallback;
};

function collectSseText(res, onProgress) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", answer = "", usage = {}, t0 = Date.now(), lastPing = -1;
  return (async () => {
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
        } catch { /* SSE data satırı tam JSON olmalı; bozuksa yoksay. */ }
      }
      const sec = Math.round((Date.now() - t0) / 1000);
      if (onProgress && sec !== lastPing) {
        lastPing = sec;
        onProgress(sec, usage.thoughtsTokenCount || 0);
      }
    }
    return { text: answer, usage };
  })();
}

// --- WORDS/CLUES: normal ve stream metin çağrıları → { text, usage } ---
async function geminiText(key, prompt, mimeType, imageBase64, thinking) {
  const res = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: geminiBodyFor(prompt, mimeType, imageBase64, thinking)
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

async function geminiStreamText(key, prompt, mimeType, imageBase64, thinking, onProgress) {
  const res = await fetch(GEMINI_STREAM_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: geminiBodyFor(prompt, mimeType, imageBase64, thinking)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 200)}`);
  }
  const out = await collectSseText(res, onProgress);
  if (!out.text) { const e = new Error("Gemini boş yanıt döndürdü."); e.usage = out.usage; throw e; }
  return out;
}

// Flash bazen sayıklayıp diziyi yazmaz; bir kez yeniden dener. Token tüketimi toplanır.
async function geminiArray(key, prompt, mimeType, imageBase64, thinking, options = {}) {
  let lastErr, usage = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const call = options.stream
        ? geminiStreamText(key, prompt, mimeType, imageBase64, thinking, options.onProgress)
        : geminiText(key, prompt, mimeType, imageBase64, thinking);
      const { text, usage: u } = await call;
      usage = sumUsage(usage, u);
      return { array: extractArray(text), usage };
    } catch (e) { lastErr = e; if (e && e.usage) usage = sumUsage(usage, e.usage); }
  }
  lastErr.usage = usage;
  throw lastErr;
}

async function geminiClues(key, slots, mimeType, imageBase64, thinking, options = {}) {
  const stream = options.stream || thinking !== "low";
  if (slots && slots.length) {
    const r = await geminiArray(key, slotCluesPrompt(slots), mimeType, imageBase64, thinking, { ...options, stream });
    return { words: slotPairsToClues(r.array, slots), usage: r.usage };
  }
  const r = await geminiArray(key, wordsPrompt, mimeType, imageBase64, thinking, { ...options, stream });
  return { words: triplesToClues(r.array), usage: r.usage };
}

function openaiUsage(u) {
  const output = u && Number(u.output_tokens || 0);
  const reasoning = u && u.output_tokens_details && Number(u.output_tokens_details.reasoning_tokens || 0);
  const input = u && Number(u.input_tokens || 0);
  const total = u && Number(u.total_tokens || (input + output));
  return {
    promptTokenCount: input || 0,
    candidatesTokenCount: Math.max(0, (output || 0) - (reasoning || 0)),
    thoughtsTokenCount: reasoning || 0,
    totalTokenCount: total || 0
  };
}

function openaiOutputText(data) {
  if (!data) return "";
  if (typeof data.output_text === "string") return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    if (typeof item.text === "string") chunks.push(item.text);
    for (const c of item.content || []) {
      if (typeof c.text === "string") chunks.push(c.text);
      else if (c.text && typeof c.text.value === "string") chunks.push(c.text.value);
      else if (typeof c.output_text === "string") chunks.push(c.output_text);
    }
  }
  return chunks.join("");
}

async function openaiError(res) {
  const detail = await res.text().catch(() => "");
  try {
    const j = JSON.parse(detail);
    return (j && j.error && (j.error.message || j.error.code)) || detail;
  } catch {
    return detail;
  }
}

async function openaiText(key, prompt, mimeType, imageBase64, thinking) {
  const res = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${key}` },
    body: openaiBodyFor(prompt, mimeType, imageBase64, thinking, false)
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await openaiError(res)).slice(0, 200)}`);
  const data = await res.json().catch(() => null);
  const usage = openaiUsage(data && data.usage);
  const text = openaiOutputText(data);
  if (!text) { const e = new Error("OpenAI boş yanıt döndürdü."); e.usage = usage; throw e; }
  return { text, usage };
}

function collectOpenAISseText(res, onProgress) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", answer = "", usage = {}, t0 = Date.now(), lastPing = -1;
  return (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          if (j.type === "response.output_text.delta" && typeof j.delta === "string") answer += j.delta;
          else if (j.type === "response.output_text.done" && !answer && typeof j.text === "string") answer = j.text;
          if (j.response && j.response.usage) usage = openaiUsage(j.response.usage);
          else if (j.usage) usage = openaiUsage(j.usage);
          if (j.response && !answer) answer += openaiOutputText(j.response);
        } catch { /* OpenAI SSE data satırı JSON değilse yoksay. */ }
      }
      const sec = Math.round((Date.now() - t0) / 1000);
      if (onProgress && sec !== lastPing) {
        lastPing = sec;
        onProgress(sec, usage.thoughtsTokenCount || 0);
      }
    }
    return { text: answer, usage };
  })();
}

async function openaiStreamText(key, prompt, mimeType, imageBase64, thinking, onProgress) {
  const res = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${key}` },
    body: openaiBodyFor(prompt, mimeType, imageBase64, thinking, true)
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await openaiError(res)).slice(0, 200)}`);
  const out = await collectOpenAISseText(res, onProgress);
  if (!out.text) { const e = new Error("OpenAI boş yanıt döndürdü."); e.usage = out.usage; throw e; }
  return out;
}

async function openaiArray(key, prompt, mimeType, imageBase64, thinking, options = {}) {
  const call = options.stream
    ? openaiStreamText(key, prompt, mimeType, imageBase64, thinking, options.onProgress)
    : openaiText(key, prompt, mimeType, imageBase64, thinking);
  const { text, usage } = await call;
  return { array: extractArray(text), usage };
}

async function openaiClues(key, slots, mimeType, imageBase64, thinking, options = {}) {
  const opts = { ...options, stream: true };
  if (slots && slots.length) {
    const r = await openaiArray(key, slotCluesPrompt(slots), mimeType, imageBase64, thinking, opts);
    return { words: slotPairsToClues(r.array, slots), usage: r.usage };
  }
  const r = await openaiArray(key, wordsPrompt, mimeType, imageBase64, thinking, opts);
  return { words: triplesToClues(r.array), usage: r.usage };
}

async function openaiGrid(key, prompt, mimeType, imageBase64, thinking, onProgress) {
  const r = await openaiArray(key, prompt, mimeType, imageBase64, thinking, { stream: true, onProgress });
  return { array: r.array, usage: r.usage };
}

function readClues(provider, key, slots, mimeType, imageBase64, thinking, options = {}) {
  return provider === "openai"
    ? openaiClues(key, slots, mimeType, imageBase64, thinking, options)
    : geminiClues(key, slots, mimeType, imageBase64, thinking, options);
}

function readGrid(provider, key, prompt, mimeType, imageBase64, thinking, onProgress) {
  return provider === "openai"
    ? openaiGrid(key, prompt, mimeType, imageBase64, thinking, onProgress)
    : streamGrid(key, prompt, mimeType, imageBase64, thinking, onProgress);
}

function startHeartbeat(writeLine, base, ms = 10000) {
  const t0 = Date.now();
  let stop = false, id = null;
  const tick = () => {
    if (stop) return;
    writeLine({ t: "progress", sec: Math.round((Date.now() - t0) / 1000), heartbeat: true, ...base });
    id = setTimeout(tick, ms);
  };
  id = setTimeout(tick, ms);
  return () => { stop = true; if (id) clearTimeout(id); };
}

// --- GRID: AKIŞ çağrısı. SSE'yi okur, "düşünce" parçaları bağlantıyı canlı tutar,
// cevap parçaları biriktirilir. onProgress(sec, thoughtTokens) ~saniyede bir çağrılır.
// → { array, usage }. extractArray hatasında usage hataya iliştirilir. ---
async function streamGridOnce(key, prompt, mimeType, imageBase64, thinking, onProgress) {
  const res = await fetch(GEMINI_STREAM_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: geminiBodyFor(prompt, mimeType, imageBase64, thinking)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 200)}`);
  }
  const { text, usage } = await collectSseText(res, onProgress);
  try { return { array: extractArray(text), usage }; }
  catch (e) { e.usage = usage; throw e; }
}

async function streamGrid(key, prompt, mimeType, imageBase64, thinking, onProgress) {
  let lastErr, usage = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await streamGridOnce(key, prompt, mimeType, imageBase64, thinking, onProgress);
      return { array: r.array, usage: sumUsage(usage, r.usage) };
    } catch (e) { lastErr = e; if (e && e.usage) usage = sumUsage(usage, e.usage); }
  }
  lastErr.usage = usage;
  throw lastErr;
}

// İki çağrının sonucundan tek yanıt nesnesi (JSON yolu ve akış "result" satırı ortak).
function assembleResult(provider, wRes, gRes, withGrid, meta = {}) {
  const cfg = PROVIDERS[provider] || PROVIDERS[DEFAULT_PROVIDER];
  const usageOf = r => r.status === "fulfilled" ? (r.value && r.value.usage) || {} : (r.reason && r.reason.usage) || {};
  const wUsage = usageOf(wRes);
  const gUsage = withGrid ? usageOf(gRes) : null;
  const total = sumUsage(wUsage, gUsage || {});
  const usage = { words: wUsage, grid: gUsage, total };
  const cost = {
    usd: costUsd(total, cfg), words: costUsd(wUsage, cfg), grid: gUsage ? costUsd(gUsage, cfg) : 0,
    rateInPerM: cfg.priceInPerM, rateOutPerM: cfg.priceOutPerM
  };
  const base = { provider, model: cfg.model, usage, cost, ...meta };
  if (wRes.status === "rejected")
    return { ok: false, error: "İpuçları okunamadı.",
      detail: String(wRes.reason && wRes.reason.message || wRes.reason).slice(0, 300), ...base };
  const words = wRes.value.words || triplesToClues(wRes.value.array);
  let grid = null, gridError = null;
  if (withGrid) {
    if (gRes.status === "fulfilled" && gRes.value && Array.isArray(gRes.value.array))
      grid = gRes.value.array.map(r => String(r));
    else gridError = String(gRes.reason && gRes.reason.message || gRes.reason || "Izgara okunamadı.").slice(0, 200);
  }
  return { ok: true, ...base, words, grid, gridError };
}

export const onRequestPost = async ({ env, request, waitUntil }) => {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Geçersiz JSON." }, 400); }

  const provider = providerName(body && body.provider);
  const cfg = PROVIDERS[provider];
  const key = env[cfg.envName];
  if (!key) return json({ ok: false, error: `${cfg.envName} tanımlı değil.`, provider, model: cfg.model }, 503);

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
  const gridThinking = thinkingLevel(body && body.gridThinking, cfg.defaultGridThinking, cfg.thinkingLevels);
  const clueThinking = thinkingLevel(body && body.clueThinking, cfg.defaultClueThinking, cfg.thinkingLevels);
  const meta = { thinking: { grid: withGrid ? gridThinking : null, clues: clueThinking } };

  // --- Yalnızca ipuçları: hızlı (~60 sn < 100 sn) → düz JSON yanıt. ---
  if (!withGrid) {
    if (provider === "openai" || clueThinking !== "low") {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const enc = new TextEncoder();
      const writeLine = o => writer.write(enc.encode(JSON.stringify(o) + "\n")).catch(() => {});
      const pump = (async () => {
        let wRes;
        const stopWords = startHeartbeat(writeLine, { phase: "words", count: requestSlots.length, provider });
        try {
          wRes = await Promise.allSettled([readClues(provider, key, requestSlots, mimeType, imageBase64, clueThinking, {
            stream: true,
            onProgress: (sec, think) => writeLine({ t: "progress", phase: "words", sec, think, count: requestSlots.length, provider })
          })]).then(a => a[0]);
          await writeLine({ t: "result", ...assembleResult(provider, wRes, { status: "fulfilled", value: null }, false, meta) });
        } catch (e) {
          await writeLine({ t: "error", error: String(e && e.message || e).slice(0, 300) });
        } finally {
          stopWords();
          await writer.close().catch(() => {});
        }
      })();
      if (waitUntil) waitUntil(pump);
      return new Response(readable, {
        status: 200,
        headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" }
      });
    }
    const wRes = await Promise.allSettled([readClues(provider, key, requestSlots, mimeType, imageBase64, clueThinking)]).then(a => a[0]);
    const result = assembleResult(provider, wRes, { status: "fulfilled", value: null }, false, meta);
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
    let stopGrid = () => {}, stopWords = () => {};
    try {
      log("pump start", JSON.stringify({ provider, rows, cols, gridThinking, clueThinking }));
      stopGrid = startHeartbeat(writeLine, { phase: "grid", provider });
      const gridP = readGrid(provider, key, gridPrompt(rows, cols), mimeType, imageBase64,
        gridThinking,
        (sec, think) => { if (sec % 15 === 0) log("grid akıyor", sec + "s", think + " düşünce-tok"); return writeLine({ t: "progress", phase: "grid", provider, sec, think }); });
      const gRes = await Promise.allSettled([gridP]).then(a => a[0]);
      stopGrid();
      let wRes;
      if (gRes.status === "fulfilled") {
        const gridRows = (gRes.value.array || []).map(r => String(r));
        const slots = slotsFromSolution(gridRows);
        await writeLine({ t: "grid", count: slots.length, grid: gridRows });
        await writeLine({ t: "progress", phase: "words", count: slots.length });
        stopWords = startHeartbeat(writeLine, { phase: "words", count: slots.length, provider });
        wRes = await Promise.allSettled([readClues(provider, key, slots, mimeType, imageBase64, clueThinking, {
          stream: true,
          onProgress: (sec, think) => writeLine({ t: "progress", phase: "words", sec, think, count: slots.length, provider })
        })]).then(a => a[0]);
        stopWords();
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
      await writeLine({ t: "result", ...assembleResult(provider, wRes, gRes, true, meta) });
      log("result yazildi");
    } catch (e) {
      log("PUMP HATA", String(e && e.message || e));
      await writeLine({ t: "error", error: String(e && e.message || e).slice(0, 300) });
    } finally {
      stopGrid();
      stopWords();
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
