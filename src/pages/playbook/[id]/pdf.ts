/** PDF des Playbooks herunterladen, nur mit gültigem Zugang. Jeder Download wird gezählt. */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { dateiPfad, downloadMerken, istPlaybook, PLAYBOOKS, playbookDateien, zugangLesen, zugangStatus } from '../../../lib/playbooks';

// Eigene Antwort statt Response.redirect, deren Kopfzeilen die Middleware nicht ergänzen dürfte
const zurueck = (pfad: string) => new Response(null, { status: 303, headers: { location: pfad, 'cache-control': 'no-store' } });

export const GET: APIRoute = async ({ params, url, locals }) => {
  const zugang = await zugangLesen(params.id ?? '');
  if (!zugang || !istPlaybook(zugang.playbook) || zugangStatus(zugang) !== 'gueltig') {
    // Zurück auf die Seite, dort steht, warum es nicht geht
    return zurueck(`/playbook/${params.id ?? ''}`);
  }
  if (!playbookDateien(zugang.playbook)?.pdfBytes) return zurueck(`/playbook/${zugang.id}`);

  const datei = await env.ASSETS.fetch(new URL(dateiPfad(zugang.playbook, 'playbook.pdf'), url));
  if (!datei.ok) return new Response('Die PDF ist gerade nicht verfügbar.', { status: 503 });

  const name = `${PLAYBOOKS[zugang.playbook].name}.pdf`;
  // Zählen im Hintergrund, die Datei geht sofort raus
  const merken = downloadMerken(zugang.id).catch((f) => console.error('Download nicht gezählt', f));
  (locals as { cfContext?: ExecutionContext }).cfContext?.waitUntil(merken);
  return new Response(datei.body, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
};
