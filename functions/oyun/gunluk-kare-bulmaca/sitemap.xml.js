import { todayInIstanbul } from "../../_lib/dates.js";
import { isoToUrlDate } from "../../_lib/engine.js";

// GET /oyun/gunluk-kare-bulmaca/sitemap.xml
// Yayında olan (taslak değil, tarihi gelmiş) bulmacaları listeler. İçerik
// dinamik olduğundan sitemap de D1'den üretilir; statik dosya bayatlardı.
// Cumhuriyet'in kök robots.txt'si bu adresi `Sitemap:` ile gösterebilir.
const SITE = "https://www.cumhuriyet.com.tr/oyun/gunluk-kare-bulmaca";

export const onRequestGet = async ({ env }) => {
  const today = todayInIstanbul();
  const { results } = await env.DB
    .prepare("SELECT puzzle_date FROM puzzles WHERE status!='draft' AND puzzle_date<=? ORDER BY puzzle_date DESC LIMIT 2000")
    .bind(today)
    .all();

  const urls = [
    `  <url><loc>${SITE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    `  <url><loc>${SITE}/arsiv</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`
  ];
  for (const r of results || []) {
    urls.push(`  <url><loc>${SITE}/${isoToUrlDate(r.puzzle_date)}</loc><lastmod>${r.puzzle_date}</lastmod></url>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;

  return new Response(xml, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" }
  });
};
