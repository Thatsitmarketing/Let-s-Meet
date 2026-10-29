import type { APIRoute } from 'astro';
import { eins } from '../../../../../lib/db';
import { qrLink, qrPng, qrSvg } from '../../../../../lib/qr';
import type { Terminart } from '../../../../../lib/typen';

/**
 * QR-Code zum Link einer Terminart. `?format=png|svg`, mit `&download=1` als Datei zum Speichern.
 * Nur im Backoffice (Middleware schützt /api/app).
 */
export const GET: APIRoute = async ({ params, url, locals }) => {
  const nutzer = locals.gastgeber!;
  const ta = await eins<Pick<Terminart, 'slug' | 'titel'>>(
    'SELECT slug, titel FROM terminarten WHERE id = ? AND nutzer_id = ?',
    params.id ?? '',
    nutzer.id,
  );
  if (!ta) return new Response('Nicht gefunden', { status: 404 });

  const link = qrLink(ta.slug, url);
  const svg = url.searchParams.get('format') === 'svg';
  const kopf = new Headers({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  if (url.searchParams.get('download')) {
    kopf.set('Content-Disposition', `attachment; filename="qr-code-${ta.slug}.${svg ? 'svg' : 'png'}"`);
  }
  if (svg) {
    kopf.set('Content-Type', 'image/svg+xml; charset=utf-8');
    return new Response(qrSvg(link, `QR-Code ${ta.titel}`), { headers: kopf });
  }
  kopf.set('Content-Type', 'image/png');
  return new Response(await qrPng(link), { headers: kopf });
};
