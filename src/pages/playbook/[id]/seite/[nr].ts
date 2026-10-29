/** Einzelne Seite des Flipbooks als Bild, nur mit gültigem Zugang. */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { dateiPfad, istPlaybook, playbookDateien, seitenDatei, zugangLesen, zugangStatus } from '../../../../lib/playbooks';

export const GET: APIRoute = async ({ params, url }) => {
  const nr = Number.parseInt(params.nr ?? '', 10);
  const zugang = await zugangLesen(params.id ?? '');
  if (!zugang || !istPlaybook(zugang.playbook) || zugangStatus(zugang) !== 'gueltig') return new Response(null, { status: 404 });
  const info = playbookDateien(zugang.playbook);
  if (!info || !Number.isInteger(nr) || nr < 1 || nr > info.seiten) return new Response(null, { status: 404 });

  const datei = await env.ASSETS.fetch(new URL(dateiPfad(zugang.playbook, seitenDatei(nr)), url));
  if (!datei.ok) return new Response(null, { status: 404 });
  return new Response(datei.body, {
    headers: {
      'content-type': 'image/webp',
      // Nur im Browser der Person zwischenspeichern, nicht in geteilten Caches
      'cache-control': 'private, max-age=3600',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
};
