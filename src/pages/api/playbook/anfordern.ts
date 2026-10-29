/**
 * Schnittstelle für die vier Playbook Landingpages (serverseitig, nie aus dem Browser).
 * POST JSON { playbook, name, email, telefon?, unternehmen? } mit Authorization: Bearer PLAYBOOK_SCHLUESSEL.
 * Antwort { link, gueltigBis }. Legt Kontakt und persönlichen Zugang an, die Mail schickt die Landingpage.
 */
import type { APIRoute } from 'astro';
import { buero } from '../../../lib/abfragen';
import { basisUrl } from '../../../lib/buchungen';
import { emailGueltig, json, telefonGueltig, trimmen } from '../../../lib/eingabe';
import { anfrageBerechtigt, istPlaybook, playbookDateien, zugangAnlegen } from '../../../lib/playbooks';

export const POST: APIRoute = async ({ request, url }) => {
  if (!anfrageBerechtigt(request)) return json(401, { fehler: 'Nicht berechtigt' });

  let d: Record<string, unknown>;
  try {
    d = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { fehler: 'Ungültige Anfrage' });
  }

  const playbook = trimmen(d.playbook, 20);
  const name = trimmen(d.name, 120);
  const email = trimmen(d.email, 180).toLowerCase();
  const telefonRoh = trimmen(d.telefon, 40);
  const unternehmen = trimmen(d.unternehmen, 160) || null;

  const felder: Record<string, string> = {};
  if (!istPlaybook(playbook)) felder.playbook = 'Unbekanntes Playbook';
  if (name.length < 2) felder.name = 'Name fehlt';
  if (!emailGueltig(email)) felder.email = 'E Mail ungültig';
  if (Object.keys(felder).length || !istPlaybook(playbook)) return json(422, { felder });

  const gastgeber = await buero();
  if (!gastgeber) return json(503, { fehler: 'Kein Büro eingerichtet' });

  // Eine ungültige Nummer verhindert das Playbook nicht, sie wird nur nicht gespeichert
  const telefon = telefonRoh && telefonGueltig(telefonRoh) ? telefonRoh : null;

  // Noch keine Dateien hinterlegt: Lead trotzdem erfassen, die Landingpage nimmt ihren bisherigen Downloadlink
  const mitDateien = Boolean(playbookDateien(playbook));
  const { id, gueltigBis } = await zugangAnlegen(gastgeber.id, { playbook, name, email, telefon, unternehmen }, mitDateien);
  if (!mitDateien) return json(200, { link: null, grund: 'Für dieses Playbook sind in Let\'s Meet noch keine Dateien hinterlegt.' });

  return json(200, { link: `${basisUrl(url)}/playbook/${id}`, gueltigBis });
};
