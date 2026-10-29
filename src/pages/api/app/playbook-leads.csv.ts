/** CSV Export der Leadliste /app/playbook-leads, mit denselben Filtern. */
import type { APIRoute } from 'astro';
import { istPlaybook, LEAD_STAND, leadAbfrage, PLAYBOOKS, zugangStatus, type LeadStand } from '../../../lib/playbooks';
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
  const playbook = istPlaybook(p.get('playbook')) ? (p.get('playbook') as keyof typeof PLAYBOOKS) : null;
  const stand = LEAD_STAND.includes(p.get('stand') as LeadStand) ? (p.get('stand') as LeadStand) : 'alle';
  const zeilen = await leadAbfrage(nutzer.id, { playbook, stand, suche: (p.get('suche') ?? '').trim().slice(0, 100) }).liste(10000, 0);
  const tz = nutzer.zeitzone;
  const wann = (iso: string | null) => (iso ? `${formatDatumMittel(iso, tz)} ${formatZeit(iso, tz)}` : '');
  const kopf = ['Name', 'E Mail', 'Telefon', 'Unternehmen', 'Playbook', 'Angefordert am', 'Geöffnet', 'Zuletzt geöffnet', 'PDF geladen', 'Zuletzt geladen', 'Link'];
  const daten = zeilen.map((z) => {
    const st = zugangStatus(z);
    return [
      z.kontakt_name ?? z.name, z.email, z.kontakt_telefon ?? z.telefon, z.kontakt_unternehmen ?? z.unternehmen,
      istPlaybook(z.playbook) ? PLAYBOOKS[z.playbook].name : z.playbook,
      wann(z.erstellt_am), z.aufrufe, wann(z.zuletzt_geoeffnet), z.downloads, wann(z.zuletzt_geladen),
      !z.link_versendet ? 'Alter Downloadlink' : st === 'gueltig' ? `gültig bis ${formatDatumMittel(z.gueltig_bis, tz)}` : st === 'gesperrt' ? 'gesperrt' : 'abgelaufen',
    ].map(zelle).join(';');
  });
  const csv = '﻿' + [kopf.map(zelle).join(';'), ...daten].join('\r\n');
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="playbook-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
};
