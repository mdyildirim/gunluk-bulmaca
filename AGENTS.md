# Günlük Kare Bulmaca — Deployment Notes

Standalone Cloudflare **Pages** project. Mirrors the `wow` (kelime-oyunu)
conventions but is a **separate repo, project, and database**. Do not touch the
`wow` repo from here.

## Cloudflare Pages project

| Purpose | Pages project | Build | Deploy |
|---|---|---|---|
| Günlük Kare Bulmaca | `cumhuriyet-gunluk-bulmaca` | none (static `public/` + Functions) | `npm run deploy` |

No build step: `public/` is the output dir; Pages Functions are auto-discovered
from `functions/`.

## Cumhuriyet integration

Cumhuriyet controls `cumhuriyet.com.tr/oyun/*` via their own Worker (it proxies
that path to Lidyagames Pages projects). This game is mounted at:

```
cumhuriyet.com.tr/oyun/gunluk-kare-bulmaca/*  ->  <this-project>.pages.dev/oyun/gunluk-kare-bulmaca/*
```

Everything in this repo physically lives under `/oyun/gunluk-kare-bulmaca/`
(static assets, Functions, and API), so the proxy maps path-for-path with no
base-path rewriting. Ask Cumhuriyet to add the `/oyun/gunluk-kare-bulmaca/*`
route to their Worker, pointing at this project's `pages.dev` origin (a custom
subdomain such as `bulmaca.lidyagames.com` can sit in front if preferred).

`lidyagames.com` = our domain · `cumhuriyet.com.tr` = client domain.

## Bindings & secrets

- `DB` — D1 database `gunluk-bulmaca` (own database; **not** `world-of-words`).
  Set `database_id` in `wrangler.jsonc` after `wrangler d1 create`.
- `ADMIN_PASSWORD` (required) / `ADMIN_USERNAME` (optional, default `admin`) —
  HTTP Basic auth for `/oyun/gunluk-kare-bulmaca/admin.html` and
  `/oyun/gunluk-kare-bulmaca/api/admin/*`, enforced in `functions/_middleware.js`.
  Admin paths fail closed (503) if `ADMIN_PASSWORD` is unset.

```bash
wrangler pages secret put ADMIN_PASSWORD --project-name cumhuriyet-gunluk-bulmaca
```

- `GEMINI_API_KEY` (optional) — enables **"Görselden içe aktar"** in the editor:
  `POST /api/admin/import` sends an uploaded puzzle photo to `gemini-3.5-flash`,
  which returns a grid + clue list that pre-fills the editor (the editor then
  validates/saves as usual). Endpoint fails closed (503) if the key is unset, so
  the rest of the editor works without it. Set locally in `.dev.vars`; in prod:

```bash
wrangler pages secret put GEMINI_API_KEY --project-name cumhuriyet-gunluk-bulmaca
```

- `OPENAI_API_KEY` (optional) — enables the OpenAI provider in the same editor
  import flow. The admin UI sends the solved puzzle photo to `gpt-5.5` through
  the Responses API, using the same grid-slot reconciliation as Gemini. Set
  locally in `.dev.vars`; in prod:

```bash
wrangler pages secret put OPENAI_API_KEY --project-name cumhuriyet-gunluk-bulmaca
```

The admin surface must **not** be exposed through the Cumhuriyet proxy — keep
`/api/admin/*` reachable only on the `pages.dev` origin.

## Data model

- D1 table `puzzles`, keyed by `puzzle_date` (YYYY-MM-DD, Europe/Istanbul).
- No cron, no KV. "Today" = the row whose date is today. A future-dated
  `scheduled` row becomes live automatically when its date arrives.
- `/api/puzzle/:date` hides `draft` rows and future dates; the editor previews
  drafts via the admin API / the player's offline fallback.

## SEO / robots / sitemap

- **Sitemap** is dynamic: `GET /oyun/gunluk-kare-bulmaca/sitemap.xml`
  (`functions/.../sitemap.xml.js`) lists every live (non-draft, date-reached)
  puzzle from D1. No static file to keep in sync.
- **robots.txt is only honored at the domain root.** `public/robots.txt`
  governs the `*.pages.dev` origin only (disallows `admin.html` + `/api/`).
  Crawlers ignore a robots.txt under `/oyun/...`, so **ask Cumhuriyet to add to
  their root `cumhuriyet.com.tr/robots.txt`:**

  ```
  Disallow: /oyun/gunluk-kare-bulmaca/admin.html
  Disallow: /oyun/gunluk-kare-bulmaca/api/
  Sitemap: https://www.cumhuriyet.com.tr/oyun/gunluk-kare-bulmaca/sitemap.xml
  ```
- **og:image** is currently `og.svg`. Facebook/Twitter(X) do not render SVG
  share images — replace with a rasterized 1200×630 `og.png` (and switch the
  `og:image` refs in `index.html` + `[date].js`) before relying on social cards.

## Verification

```bash
npm run preview        # UI-only static check
npm run dev            # full stack (Functions + local D1)
curl http://localhost:8788/oyun/gunluk-kare-bulmaca/api/today
curl http://localhost:8788/oyun/gunluk-kare-bulmaca/sitemap.xml
```
