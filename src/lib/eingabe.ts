export const trimmen = (wert: unknown, max = 500) => String(wert ?? '').trim().slice(0, max);

export const emailGueltig = (email: string) => email.length <= 180 && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email);

export const telefonGueltig = (tel: string) => /^[0-9+()\/\s.-]{5,40}$/.test(tel) && /\d{4}/.test(tel.replace(/\D/g, ''));

export const urlGueltig = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

/** Kleinbuchstaben, Ziffern und Bindestriche für URLs. Umlaute werden umschrieben. */
export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export const RESERVIERTE_SLUGS = new Set([
  'app', 'api', 'termin', 'embed', 'embed.js', 'fonts', 'images', '_astro', 'favicon.svg', 'favicon.png', 'favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'site.webmanifest', 'robots.txt', 'setup', 'login', 'impressum', 'datenschutz',
  'sitemap.xml', '404', 'buero', 'team',
]);

export function maskieren(wert: unknown) {
  return String(wert ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function ganzzahl(wert: unknown, min: number, max: number, standard: number) {
  const n = Number.parseInt(String(wert ?? ''), 10);
  if (!Number.isFinite(n)) return standard;
  return Math.min(max, Math.max(min, n));
}

export function json(status: number, koerper: unknown, kopf: Record<string, string> = {}) {
  return new Response(JSON.stringify(koerper), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...kopf },
  });
}
