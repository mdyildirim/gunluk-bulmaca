import { requireAdminAuth } from "./_lib/admin-auth.js";

const BASE = "/oyun/gunluk-kare-bulmaca";

// Editör yüzeyi: Basic auth ile korunur. (Cumhuriyet proxy'si /api/admin'i
// dışarı açmamalı; doğrudan pages.dev üzerinden erişilir.)
function isAdminPath(p) {
  // Pages "clean URL" serving exposes admin.html at the extensionless /admin
  // too — both must be guarded, otherwise the editor page loads unauthenticated
  // (and the browser is never challenged, so the editor's /api/admin calls fail).
  return (
    p === `${BASE}/admin.html` ||
    p === `${BASE}/admin` ||
    p.startsWith(`${BASE}/api/admin/`)
  );
}

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

export const onRequest = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);

  if (isAdminPath(url.pathname)) {
    const auth = requireAdminAuth(request, env);
    if (auth) return auth;
  }

  const response = await context.next();
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  if (isAdminPath(url.pathname)) out.headers.set("Cache-Control", "no-store");
  return out;
};
