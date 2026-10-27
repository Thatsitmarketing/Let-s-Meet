import type { APIRoute } from 'astro';
import { buero, terminartenVon } from '../lib/abfragen';

export const GET: APIRoute = async ({ url }) => {
  const gastgeber = await buero();
  const arten = gastgeber ? await terminartenVon(gastgeber.id, true) : [];
  const pfade = ['/', ...arten.map((a) => `/${a.slug}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pfade
    .map((p) => `  <url><loc>${url.origin}${p}</loc></url>`)
    .join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
