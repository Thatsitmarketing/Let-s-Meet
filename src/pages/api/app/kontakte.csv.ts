import type { APIRoute } from 'astro';
import { KONTAKT_FILTER, KONTAKT_SORTIERUNG, kontaktAbfrage, type KontaktFilter, type KontaktSortierung } from '../../../lib/kontakte';
import { formatDatumKurz, formatDatumMittel, formatZeit } from '../../../lib/zeit';

const zelle = (wert: unknown) => {
  let text = String(wert ?? '');
  // Formelinjektion in Tabellenprogrammen verhindern
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

export const GET: APIRoute = async ({ url, locals }) => {
  const nutzer = locals.gastgeber!;
  const p = url.searchParams;
  const filter = KONTAKT_FILTER.includes(p.get('filter') as KontaktFilter) ? (p.get('filter') as KontaktFilter) : 'alle';
  const sortierung = KONTAKT_SORTIERUNG.includes(p.get('sort') as KontaktSortierung) ? (p.get('sort') as KontaktSortierung) : 'letztes';
  const zeilen = await kontaktAbfrage(nutzer.id, { suche: (p.get('suche') ?? '').trim().slice(0, 100), filter, sortierung }).liste(10000, 0);
  const tz = nutzer.zeitzone;
  const kopf = ['Name', 'E Mail', 'Telefon', 'Unternehmen', 'Datum des letzten Meetings', 'Datum des nächsten Meetings', 'Uhrzeit nächstes Meeting', 'Notiz', 'Herkunft', 'Angelegt am'];
  const daten = zeilen.map((k) =>
    [
      k.name, k.email, k.telefon, k.unternehmen,
      k.letztes ? formatDatumMittel(k.letztes, tz) : '',
      k.naechstes ? formatDatumMittel(k.naechstes, tz) : '',
      k.naechstes ? formatZeit(k.naechstes, tz) : '',
      k.notiz, k.quelle, formatDatumKurz(k.erstellt_am, tz),
    ].map(zelle).join(';'),
  );
  const csv = '﻿' + [kopf.map(zelle).join(';'), ...daten].join('\r\n');
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="kontakte-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
};
