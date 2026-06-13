import { isISODate, todayInIstanbul } from "../../_lib/dates.js";

// GET /oyun/gunluk-kare-bulmaca/:date
// Tarih biçimindeki yolları, güne özel SEO etiketleriyle oyuncu HTML'i olarak
// sunar (sunucuda meta enjeksiyonu → her gün benzersiz, indekslenebilir sayfa).
// Tarih olmayan tek segmentler (player.js, styles.css, admin.html, …) statik
// servise düşürülür.
const MONTHS = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];

function pretty(date) {
  const d = new Date(date + "T00:00:00");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export const onRequestGet = async (context) => {
  const { params, request, env } = context;
  const date = Array.isArray(params.date) ? params.date[0] : params.date;
  if (!isISODate(date)) return context.next(); // statik dosya veya 404

  const base = await fetch(new URL("/oyun/gunluk-kare-bulmaca/index.html", request.url));
  if (!base.ok) return context.next();
  let html = await base.text();

  const row = await env.DB
    .prepare("SELECT no,status FROM puzzles WHERE puzzle_date=?")
    .bind(date)
    .first();
  const isLive = row && row.status !== "draft" && date <= todayInIstanbul();

  const title = `${pretty(date)} Kare Bulmaca${row?.no ? " No: " + row.no : ""} — Cumhuriyet`;
  const canonical = `https://www.cumhuriyet.com.tr/oyun/gunluk-kare-bulmaca/${date}`;
  const robots = isLive ? "index, follow, max-image-preview:large" : "noindex, follow";
  const desc = `${pretty(date)} tarihli Cumhuriyet günlük kare bulmacası. Mobil ve masaüstünde kolayca çözün.`;

  const seo = [
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}" />`,
    `<meta name="robots" content="${robots}" />`,
    `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="tr_TR" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:url" content="${canonical}" />`
  ].join("\n");

  html = html.replace(/<!--SEO-START-->[\s\S]*?<!--SEO-END-->/, seo);

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=600" }
  });
};
