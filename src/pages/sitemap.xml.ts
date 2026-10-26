import type { APIRoute } from 'astro';
import { alle } from '../lib/db';

export const GET: APIRoute = async ({ url }) => {
  const zeilen = await alle<{ nutzer: string; art: string | null }>(
    `SELECT n.slug AS nutzer, t.slug AS art FROM nutzer n
     LEFT JOIN terminarten t ON t.nutzer_id = n.id AND t.aktiv = 1 AND t.geheim = 0
     WHERE n.aktiv = 1`,
  );
  const pfade = new Set<string>(['/']);
  for (const z of zeilen) {
    pfade.add(`/${z.nutzer}`);
    if (z.art) pfade.add(`/${z.nutzer}/${z.art}`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...pfade]
    .map((p) => `  <url><loc>${url.origin}${p}</loc></url>`)
    .join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
