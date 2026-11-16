/**
 * Schnittstelle für Landingpages ohne Playbook (serverseitig, nie aus dem Browser), erste Quelle
 * ist der Website Entwurf Funnel. POST JSON { quelle, name, email, telefon?, unternehmen?,
 * antworten?: [{ frage, antwort }], seite?, dublette? } mit Authorization: Bearer ANFRAGE_SCHLUESSEL.
 * Antwort { id }. Legt Kontakt und Anfrage an und meldet sie an den Close Automaten.
 */
import type { APIRoute } from 'astro';
import { buero } from '../../lib/abfragen';
import { anfrageAnlegen, anfrageBerechtigt, ANFRAGE_QUELLEN, istAnfrageQuelle } from '../../lib/anfragen';
import { crmMelden } from '../../lib/crm';
import { emailGueltig, json, telefonGueltig, trimmen } from '../../lib/eingabe';
import { antwortenPruefen } from '../../lib/playbooks';

export const POST: APIRoute = async ({ request, locals }) => {
  if (!anfrageBerechtigt(request)) return json(401, { fehler: 'Nicht berechtigt' });

  let d: Record<string, unknown>;
  try {
    d = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { fehler: 'Ungültige Anfrage' });
  }

  const quelle = trimmen(d.quelle, 40);
  const name = trimmen(d.name, 120);
  const email = trimmen(d.email, 180).toLowerCase();
  const telefonRoh = trimmen(d.telefon, 40);
  const unternehmen = trimmen(d.unternehmen, 160) || null;
  const seite = trimmen(d.seite, 500) || null;
  const dublette = d.dublette === true;
  const antworten = antwortenPruefen(d.antworten);

  const felder: Record<string, string> = {};
  if (!istAnfrageQuelle(quelle)) felder.quelle = 'Unbekannte Quelle';
  if (name.length < 2) felder.name = 'Name fehlt';
  if (!emailGueltig(email)) felder.email = 'E Mail ungültig';
  if (Object.keys(felder).length || !istAnfrageQuelle(quelle)) return json(422, { felder });

  const gastgeber = await buero();
  if (!gastgeber) return json(503, { fehler: 'Kein Büro eingerichtet' });

  // Eine ungültige Nummer verhindert die Anfrage nicht, sie wird nur nicht gespeichert
  const telefon = telefonRoh && telefonGueltig(telefonRoh) ? telefonRoh : null;
  const { id, erstelltAm } = await anfrageAnlegen(gastgeber.id, { quelle, name, email, telefon, unternehmen, antworten, seite, dublette });

  // Lead in Close (Close Automat), im Hintergrund nach der Antwort
  locals.cfContext.waitUntil(
    crmMelden('anfrage.eingegangen', {
      anfrage_id: id,
      quelle,
      quelle_name: ANFRAGE_QUELLEN[quelle].name,
      landingpage: ANFRAGE_QUELLEN[quelle].landingpage,
      seite,
      name,
      email,
      telefon: telefonRoh || null,
      unternehmen,
      antworten,
      dublette,
      zeit: erstelltAm,
    }),
  );
  return json(200, { id });
};
