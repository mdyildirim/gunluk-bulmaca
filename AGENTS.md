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

The admin surface must **not** be exposed through the Cumhuriyet proxy — keep
`/api/admin/*` reachable only on the `pages.dev` origin.

## Data model

- D1 table `puzzles`, keyed by `puzzle_date` (YYYY-MM-DD, Europe/Istanbul).
- No cron, no KV. "Today" = the row whose date is today. A future-dated
  `scheduled` row becomes live automatically when its date arrives.
- `/api/puzzle/:date` hides `draft` rows and future dates; the editor previews
  drafts via the admin API / the player's offline fallback.

## Verification

```bash
npm run preview        # UI-only static check
npm run dev            # full stack (Functions + local D1)
curl http://localhost:8788/oyun/gunluk-kare-bulmaca/api/today
```
