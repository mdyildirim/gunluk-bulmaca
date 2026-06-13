// HTTP Basic auth for the editor surface. Mirrors the wow project's pattern:
// fail-closed if ADMIN_PASSWORD is unset; constant-time compare.
const ADMIN_REALM = "Cumhuriyet Bulmaca Admin";

function fixedTimeEquals(a, b) {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function unauthorized(message = "Yetkilendirme gerekli.") {
  return new Response(message, {
    status: 401,
    headers: { "WWW-Authenticate": `Basic realm="${ADMIN_REALM}", charset="UTF-8"`, "Cache-Control": "no-store" }
  });
}

export function requireAdminAuth(request, env) {
  const expectedUser = env.ADMIN_USERNAME || "admin";
  const expectedPass = env.ADMIN_PASSWORD;
  if (!expectedPass) {
    return new Response("Admin authentication is not configured.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return unauthorized();
  let decoded = "";
  try { decoded = atob(header.slice(6)); } catch { return unauthorized(); }
  const i = decoded.indexOf(":");
  if (i < 0) return unauthorized();
  const user = decoded.slice(0, i);
  const pass = decoded.slice(i + 1);
  if (!fixedTimeEquals(user, expectedUser) || !fixedTimeEquals(pass, expectedPass)) {
    return unauthorized("Geçersiz kimlik bilgileri.");
  }
  return null;
}
