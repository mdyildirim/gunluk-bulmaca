// cumhuriyet.lidyagames.com önündeki yönlendirici (router) Worker.
//
// Cumhuriyet'in Worker'ı cumhuriyet.com.tr/oyun/* isteklerini tek bir hosta
// (cumhuriyet.lidyagames.com) proxy'ler. Bu Worker o host'u karşılar ve oyuna
// göre doğru Pages projesine dağıtır:
//
//   /oyun/gunluk-kare-bulmaca/*  ->  cumhuriyet-gunluk-bulmaca.pages.dev  (bulmaca)
//   /oyun/gunluk-bulmaca/*       ->  301  /oyun/gunluk-kare-bulmaca/*     (kısa yol)
//   geri kalan her şey           ->  lidyagames-cumhuriyet.pages.dev      (kelime-oyunu + hub)
//
// Konum/host korunur: pages.dev origin'lerine path-for-path proxy yapılır,
// Location başlığı yol-bazlı (relative) verilir; böylece tarayıcı
// cumhuriyet.com.tr üzerinde kalır, içsel host sızmaz.

const BULMACA_ORIGIN = "cumhuriyet-gunluk-bulmaca.pages.dev";
const DEFAULT_ORIGIN = "lidyagames-cumhuriyet.pages.dev";

const CANONICAL = "/oyun/gunluk-kare-bulmaca";
const ALIAS = "/oyun/gunluk-bulmaca";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Kısa yol -> kanonik yol (301), alt yolu koru.
    if (path === ALIAS || path.startsWith(ALIAS + "/")) {
      const rest = path.slice(ALIAS.length); // "" ya da "/..."
      const location = CANONICAL + (rest || "/") + url.search;
      return new Response(null, { status: 301, headers: { Location: location } });
    }

    const origin =
      path === CANONICAL || path.startsWith(CANONICAL + "/")
        ? BULMACA_ORIGIN
        : DEFAULT_ORIGIN;

    url.hostname = origin;
    url.protocol = "https:";

    const headers = new Headers(request.headers);
    headers.set("Host", origin);

    return fetch(url.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });
  },
};
