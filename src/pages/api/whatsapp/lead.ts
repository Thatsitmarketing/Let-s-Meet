/**
 * Schnittstelle der Landingpage "Kostenloser Website-Entwurf" (serverseitig, nie aus dem Browser).
 * POST JSON { name, firma?, webseite?, telefon, email?, hat_website?, hinweise?, quelle? }
 * mit Authorization: Bearer WHATSAPP_LEAD_SCHLUESSEL. Nur Leads mit WhatsApp Einwilligung schicken.
 * Antwort { id, status } mit status gesendet, geplant, vorhanden oder abgemeldet.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { emailGueltig, json, trimmen } from '../../../lib/eingabe';
import { schluesselGleich } from '../../../lib/playbooks';
import { leadAnlegen } from '../../../lib/whatsapp/bot';
import { waNummer } from '../../../lib/whatsapp/meta';

function berechtigt(request: Request) {
  const geheim = env.WHATSAPP_LEAD_SCHLUESSEL?.trim();
  if (!geheim || geheim.length < 24) return false;
  const kopf = request.headers.get('authorization') ?? '';
  const token = kopf.startsWith('Bearer ') ? kopf.slice(7).trim() : '';
  return token.length > 0 && schluesselGleich(token, geheim);
}

/** "ja"/"nein" aus dem Funnel der Landingpage, sonst: Webseite angegeben oder nicht */
function hatWebsite(wert: unknown, webseite: string) {
  if (wert === true || wert === 'ja') return true;
  if (wert === false || wert === 'nein') return false;
  return Boolean(webseite);
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!berechtigt(request)) return json(401, { fehler: 'Nicht berechtigt' });
  let d: Record<string, unknown>;
  try {
    d = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { fehler: 'Ungültige Anfrage' });
  }

  const name = trimmen(d.name, 120);
  const telefon = waNummer(trimmen(d.telefon, 40));
  const email = trimmen(d.email, 180).toLowerCase();
  const hinweise = Array.isArray(d.hinweise) ? d.hinweise.map((h) => trimmen(h, 300)).filter(Boolean).join('\n') : trimmen(d.hinweise, 1500);

  const felder: Record<string, string> = {};
  if (name.length < 2) felder.name = 'Name fehlt';
  // Nur Deutschland, Österreich und Schweiz, wie im Formular der Landingpage
  if (!/^(49|43|41)\d{6,13}$/.test(telefon)) felder.telefon = 'Telefonnummer ungültig';
  if (email && !emailGueltig(email)) felder.email = 'E Mail ungültig';
  if (Object.keys(felder).length) return json(422, { felder });

  const ergebnis = await leadAnlegen(
    {
      name,
      firma: trimmen(d.firma, 160) || null,
      webseite: trimmen(d.webseite, 200) || null,
      telefon,
      email: email || null,
      hatWebsite: hatWebsite(d.hat_website, trimmen(d.webseite, 200)),
      hinweise: hinweise || null,
      quelle: trimmen(d.quelle, 80) || 'landingpage entwurf',
    },
    (p) => locals.cfContext.waitUntil(p.catch((f) => console.error('WhatsApp Start fehlgeschlagen', f))),
  );
  return json(200, ergebnis);
};
