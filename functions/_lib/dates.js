// Bugünün tarihi, Europe/Istanbul'a göre (DST dahil), YYYY-MM-DD biçiminde.
// en-CA yereli ISO biçim verir.
export function todayInIstanbul() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
}

export const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
