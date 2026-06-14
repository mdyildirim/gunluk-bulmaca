# Cumhuriyet — Günlük Kare Bulmaca

Her gün yeni bir klasik Türkçe **kare bulmaca**: mobil + masaüstü oyuncu ve
içerik üretimi için editör paneli. Kendi **Cloudflare Pages** projesi olarak
çalışır; Cumhuriyet'in Worker'ı `cumhuriyet.com.tr/oyun/gunluk-kare-bulmaca/*`
yolunu bu projeye proxy'ler. Mimari ve anahtarlar `wow` (kelime-oyunu)
projesini örnek alır; ayrıntılar için `AGENTS.md`.

## URL yapısı

```
cumhuriyet.com.tr/oyun/gunluk-kare-bulmaca/            → bugünün bulmacası
cumhuriyet.com.tr/oyun/gunluk-kare-bulmaca/13-06-2026  → o güne ait (arşiv/paylaşım)
cumhuriyet.com.tr/oyun/gunluk-kare-bulmaca/arsiv      → genel sayfa: bugünün önizlemesi + tüm bulmacalar
cumhuriyet.com.tr/oyun/gunluk-kare-bulmaca/admin.html  → editör (Basic auth)
```

URL'de tarih Türkçe biçimde (`GG-AA-YYYY`, ör. `13-06-2026`); dahili/DB biçimi
ISO (`YYYY-AA-GG`) — dönüşüm `engine.js`'teki `urlDateToIso`/`isoToUrlDate` ile
kenarda yapılır. Tarihli sayfalar sunucuda güne özel SEO etiketleri
(title/canonical/OG/robots) ile üretilir.

## Mimari (Cloudflare Pages)

| Parça | Konum |
|---|---|
| Oyuncu | `public/oyun/gunluk-kare-bulmaca/{index.html,player.js,styles.css}` |
| Editör | `public/oyun/gunluk-kare-bulmaca/{admin.html,admin.js}` (Basic auth) |
| Motor (numaralama, kelime tespiti, doğrulama) | `public/oyun/gunluk-kare-bulmaca/shared/engine.js` — tarayıcı **ve** Functions aynı dosyayı kullanır |
| Genel/arşiv sayfası | `public/oyun/gunluk-kare-bulmaca/{arsiv.html,arsiv.js}` |
| Bugünün API'si | `functions/oyun/gunluk-kare-bulmaca/api/today.js` |
| Liste API'si (arşiv künyesi) | `functions/oyun/gunluk-kare-bulmaca/api/list.js` |
| Tarihli API | `functions/oyun/gunluk-kare-bulmaca/api/puzzle/[date].js` |
| Editör API | `functions/oyun/gunluk-kare-bulmaca/api/admin/puzzles.js` |
| SEO tarih yolu | `functions/oyun/gunluk-kare-bulmaca/[date].js` |
| Güvenlik başlıkları + admin auth | `functions/_middleware.js` |
| D1 şeması | `migrations/` |

**Cron yok, KV yok.** Bulmacalar D1'de yayın gününe göre saklanır; "bugün" =
`puzzle_date == bugün` (Europe/Istanbul). İleri tarihli bir kayıt, tarihi
geldiğinde kendiliğinden yayına girer. Yanıtlarda kısa `cache-control` ile
kenar önbelleği; gün dönümünde tazelenir.

Veri biçimi:
```json
{ "date":"2026-06-13", "no":"13", "title":"…",
  "solution":["TAM#","E#AY","KASA","#KAR"],
  "clues":{ "across":{"1":"…"}, "down":{"1":"…"} } }
```
`#` = siyah kare. Numaralandırma ve kelimeler ızgaradan **otomatik** türetilir.

## Yerel geliştirme

```bash
npm install
npm run d1:migrate:local          # yerel D1 şeması
npx wrangler d1 execute DB --local --file=seeds/local.sql   # örnek bulmacalar
npm run dev                       # wrangler pages dev (Functions + D1)
```

Yalnızca arayüz (Functions olmadan, hızlı):
```bash
npm run preview                   # http://localhost:4599/oyun/gunluk-kare-bulmaca/
```
API olmadığından kök sayfa "bu güne ait bulmaca yok" bilgisini gösterir (bu
doğru davranış). Önizleme için: `?demo` → gerçekçi örnek bulmaca · `?demo=21` →
büyük ızgara yerleşim testi. Gerçek veriyle denemek için `npm run dev`.

## İlk kurulum (Cloudflare)

```bash
wrangler d1 create gunluk-bulmaca         # çıkan id → wrangler.jsonc
npm run d1:migrate:remote
wrangler pages project create cumhuriyet-gunluk-bulmaca
npm run deploy
wrangler pages secret put ADMIN_PASSWORD --project-name cumhuriyet-gunluk-bulmaca
```

Cumhuriyet Worker'ında `/oyun/gunluk-kare-bulmaca/*` → bu projenin
`*.pages.dev` adresine yönlendirilir (detay: `AGENTS.md`).

## Günlük operasyon
1. Editör `…/admin.html`'e girer (Basic auth) → künye + çözülmüş ızgara + ipuçları.
2. **Doğrula** → eksik ipucu, geçersiz karakter, bağlantısız kare yakalanır.
3. **Önizle** → oyuncunun göreceği hali (taslak da önizlenir).
4. **Yayına Zamanla** → yayın tarihi atanır; o gün otomatik yayına girer.

## Sonraki adımlar
- Cache API + CF cache-purge (anlık güncelleme; `wow` ADMIN.md deseni).
- Arşiv sayfasına ay bazlı sayfalama / arama (çok sayıda bulmaca için).
- Yazdırma / PDF görünümü, mobil Türkçe ekran klavyesi.
- CSV içe aktarma (opsiyonel).
