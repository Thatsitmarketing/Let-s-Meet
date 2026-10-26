import type { APIRoute } from 'astro';
import { alle } from '../../../lib/db';
import { terminFilter } from '../../../lib/termin-filter';
import type { Buchung } from '../../../lib/typen';
import { formatDatumKurz, formatZeit } from '../../../lib/zeit';

const zelle = (wert: unknown) => {
  let text = String(wert ?? '');
  // Formelinjektion in Tabellenprogrammen verhindern
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

export const GET: APIRoute = async ({ url, locals }) => {
  const nutzer = locals.nutzer!;
  const f = terminFilter(url, nutzer);
  const zeilen = await alle<Buchung & { titel: string; gastgeber: string }>(
    `SELECT b.*, t.titel, n.name AS gastgeber FROM buchungen b
     JOIN terminarten t ON t.id = b.terminart_id JOIN nutzer n ON n.id = b.nutzer_id
     WHERE ${f.where} ORDER BY b.start_utc ${f.reihenfolge} LIMIT 5000`,
    ...f.werte,
  );
  const tz = nutzer.zeitzone;
  const kopf = ['Datum', 'Beginn', 'Ende', 'Terminart', 'Gastgeber', 'Name', 'E Mail', 'Telefon', 'Status', 'Absagegrund', 'Nicht erschienen', 'Antworten', 'Nachricht', 'Gebucht am'];
  const daten = zeilen.map((b) => {
    let antworten = '';
    try {
      antworten = (JSON.parse(b.antworten) as { label: string; wert: string }[]).map((a) => `${a.label}: ${a.wert}`).join(' | ');
    } catch {
      antworten = '';
    }
    return [
      formatDatumKurz(b.start_utc, tz), formatZeit(b.start_utc, tz), formatZeit(b.ende_utc, tz), b.titel, b.gastgeber, b.gast_name, b.gast_email,
      b.gast_telefon, b.status === 'storniert' ? 'Abgesagt' : 'Bestätigt', b.storno_grund, b.nicht_erschienen ? 'Ja' : '', antworten, b.nachricht,
      formatDatumKurz(b.erstellt_am, tz),
    ].map(zelle).join(';');
  });
  const csv = '﻿' + [kopf.map(zelle).join(';'), ...daten].join('\r\n');
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="termine-${f.ansicht}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
};
