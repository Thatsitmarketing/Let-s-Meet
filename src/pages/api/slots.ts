import type { APIRoute } from 'astro';
import { buchungNachId, nutzerNachId, terminartNachId } from '../../lib/abfragen';
import { json } from '../../lib/eingabe';
import { freieSlots } from '../../lib/slots';

export const GET: APIRoute = async ({ url }) => {
  const terminartId = url.searchParams.get('terminart') ?? '';
  const von = new Date(url.searchParams.get('von') ?? '');
  const bis = new Date(url.searchParams.get('bis') ?? '');
  if (!terminartId || Number.isNaN(von.getTime()) || Number.isNaN(bis.getTime()) || bis <= von) {
    return json(400, { fehler: 'Ungültige Anfrage' });
  }
  if (bis.getTime() - von.getTime() > 45 * 86_400_000) return json(400, { fehler: 'Zeitraum zu groß' });

  const terminart = await terminartNachId(terminartId);
  if (!terminart || !terminart.aktiv) return json(404, { fehler: 'Terminart nicht gefunden' });
  const nutzer = await nutzerNachId(terminart.nutzer_id);
  if (!nutzer || !nutzer.aktiv) return json(404, { fehler: 'Terminart nicht gefunden' });

  let ohne: string | null = null;
  const umbuchen = url.searchParams.get('umbuchen');
  if (umbuchen) {
    const alt = await buchungNachId(umbuchen);
    if (alt && alt.terminart_id === terminart.id && alt.status === 'bestaetigt') ohne = alt.id;
  }

  const slots = await freieSlots({ terminart, nutzer, von, bis, ohneBuchung: ohne });
  return json(200, { slots });
};
