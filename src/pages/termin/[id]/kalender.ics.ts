import type { APIRoute } from 'astro';
import { buchungNachId, nutzerNachId, terminartNachId } from '../../../lib/abfragen';
import { icsDatei } from '../../../lib/ics';

export const GET: APIRoute = async ({ params, url }) => {
  const b = await buchungNachId(params.id ?? '');
  if (!b) return new Response('Nicht gefunden', { status: 404 });
  const [ta, n] = await Promise.all([terminartNachId(b.terminart_id), nutzerNachId(b.nutzer_id)]);
  if (!ta || !n) return new Response('Nicht gefunden', { status: 404 });
  const datei = icsDatei({
    uid: b.id,
    titel: `${ta.titel} mit ${n.name} (That's it. Marketing)`,
    beschreibung: [b.meeting_url ? `Meeting: ${b.meeting_url}` : '', `Termin verwalten: ${url.origin}/termin/${b.id}`].filter(Boolean).join('\n'),
    start: b.start_utc,
    ende: b.ende_utc,
    ort: b.meeting_url || b.ort_text,
    url: `${url.origin}/termin/${b.id}`,
    veranstalterName: n.name,
    veranstalterEmail: n.email,
    gastName: b.gast_name,
    gastEmail: b.gast_email,
    storniert: b.status === 'storniert',
  });
  return new Response(datei, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="termin-${ta.slug}.ics"`,
      'cache-control': 'no-store',
    },
  });
};
