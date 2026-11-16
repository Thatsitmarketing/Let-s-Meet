/** CSV Export der Anfragen /app/anfragen, mit denselben Filtern. */
import type { APIRoute } from 'astro';
import { ANFRAGE_QUELLEN, anfrageAbfrage, anfrageAntworten, istAnfrageQuelle, type AnfrageQuelle } from '../../../lib/anfragen';
import { formatDatumMittel, formatZeit } from '../../../lib/zeit';

const zelle = (wert: unknown) => {
  let text = String(wert ?? '');
  // Formelinjektion in Tabellenprogrammen verhindern
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

export const GET: APIRoute = async ({ url, locals }) => {
  const nutzer = locals.gastgeber!;
  const p = url.searchParams;
  const quelle = istAnfrageQuelle(p.get('quelle')) ? (p.get('quelle') as AnfrageQuelle) : null;
  const zeilen = await anfrageAbfrage(nutzer.id, { quelle, suche: (p.get('suche') ?? '').trim().slice(0, 100) }).liste(10000, 0);
  const tz = nutzer.zeitzone;
  const kopf = ['Name', 'E Mail', 'Telefon', 'Unternehmen', 'Quelle', 'Angaben', 'Eingegangen am', 'Wiederholte Anfrage', 'Seite'];
  const daten = zeilen.map((z) =>
    [
      z.kontakt_name ?? z.name, z.email, z.kontakt_telefon ?? z.telefon, z.kontakt_unternehmen ?? z.unternehmen,
      istAnfrageQuelle(z.quelle) ? ANFRAGE_QUELLEN[z.quelle].name : z.quelle,
      anfrageAntworten(z).map((a) => `${a.frage}: ${a.antwort}`).join(' | '),
      `${formatDatumMittel(z.erstellt_am, tz)} ${formatZeit(z.erstellt_am, tz)}`,
      z.dublette ? 'ja' : '', z.seite,
    ].map(zelle).join(';'),
  );
  const csv = '\ufeff' + [kopf.map(zelle).join(';'), ...daten].join('\r\n');
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="anfragen-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
};
