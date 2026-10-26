import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { buchungNachId, fragenLesen, nutzerNachId, terminartNachId } from '../../lib/abfragen';
import { basisUrl, buchungAnlegen, SlotVergeben } from '../../lib/buchungen';
import { emailGueltig, json, telefonGueltig, trimmen } from '../../lib/eingabe';
import { slotFrei } from '../../lib/slots';
import { gueltigeZone } from '../../lib/zeit';

async function turnstileGueltig(token: string, ip: string) {
  const geheim = env.TURNSTILE_SECRET_KEY;
  if (!geheim) return true; // lokale Entwicklung ohne Schlüssel
  if (!token) return false;
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: geheim, response: token, remoteip: ip }),
  });
  const ergebnis = (await res.json()) as { success: boolean };
  return ergebnis.success === true;
}

export const POST: APIRoute = async ({ request, clientAddress, locals, url }) => {
  let d: Record<string, unknown>;
  try {
    d = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { fehler: 'Ungültige Anfrage' });
  }

  // Honigtopf und Mindestzeit: Bots bekommen eine Erfolgsantwort ohne Wirkung
  if (trimmen(d.website)) return json(200, { ok: true, id: null });
  const ts = Number(d.ts || 0);
  if (ts && Date.now() - ts < 2500) return json(200, { ok: true, id: null });

  if (!(await turnstileGueltig(trimmen(d.turnstile, 4000), clientAddress))) {
    return json(400, { fehler: 'Die Sicherheitsprüfung ist fehlgeschlagen. Bitte lade die Seite neu und versuch es noch einmal.' });
  }

  const terminart = await terminartNachId(trimmen(d.terminart, 64));
  if (!terminart || !terminart.aktiv) return json(404, { fehler: 'Diese Terminart ist nicht mehr buchbar.' });
  const nutzer = await nutzerNachId(terminart.nutzer_id);
  if (!nutzer || !nutzer.aktiv) return json(404, { fehler: 'Diese Terminart ist nicht mehr buchbar.' });

  const name = trimmen(d.name, 120);
  const email = trimmen(d.email, 180).toLowerCase();
  const telefon = trimmen(d.telefon, 40);
  const nachricht = trimmen(d.nachricht, 5000);
  const zeitzone = gueltigeZone(trimmen(d.zeitzone, 64)) ? trimmen(d.zeitzone, 64) : nutzer.zeitzone;
  const start = trimmen(d.start, 40);

  const felder: Record<string, string> = {};
  if (name.length < 2) felder.name = 'Bitte gib deinen Namen an.';
  if (!emailGueltig(email)) felder.email = 'Bitte prüf deine E Mail Adresse.';
  if (terminart.ort_typ === 'telefon_wir' && !telefonGueltig(telefon)) felder.telefon = 'Bitte gib eine Telefonnummer an, unter der wir dich erreichen.';
  else if (telefon && !telefonGueltig(telefon)) felder.telefon = 'Bitte prüf die Telefonnummer.';
  if (!d.datenschutz) felder.datenschutz = 'Bitte bestätige die Datenschutzhinweise.';

  const rohAntworten = (d.antworten && typeof d.antworten === 'object' ? d.antworten : {}) as Record<string, unknown>;
  const antworten: { label: string; wert: string }[] = [];
  for (const frage of fragenLesen(terminart)) {
    const wert = trimmen(rohAntworten[frage.id], 2000);
    if (frage.pflicht && !wert) felder[`frage_${frage.id}`] = 'Bitte füll dieses Feld aus.';
    if (wert) antworten.push({ label: frage.label, wert });
  }
  if (Object.keys(felder).length) return json(422, { felder });

  // Umbuchen: alte Buchung muss bestehen, bestätigt sein und zur Terminart passen
  let umbuchenVon = null;
  if (d.umbuchen) {
    umbuchenVon = await buchungNachId(trimmen(d.umbuchen, 64));
    if (!umbuchenVon || umbuchenVon.status !== 'bestaetigt' || umbuchenVon.terminart_id !== terminart.id) {
      return json(409, { fehler: 'Dieser Termin kann nicht mehr umgebucht werden.' });
    }
  }

  if (!(await slotFrei({ terminart, nutzer, startUtc: start, ohneBuchung: umbuchenVon?.id }))) {
    return json(409, { fehler: 'Diese Uhrzeit ist leider nicht mehr frei. Bitte wähl einen anderen Slot.', slotWeg: true });
  }

  try {
    const buchung = await buchungAnlegen({
      terminart,
      nutzer,
      startUtc: start,
      gastName: name,
      gastEmail: email,
      gastTelefon: telefon || null,
      gastZeitzone: zeitzone,
      antworten,
      nachricht: nachricht || null,
      quelle: trimmen(d.quelle, 300) || null,
      umbuchenVon,
      basis: basisUrl(url),
      imHintergrund: (p) => locals.cfContext.waitUntil(p),
    });
    return json(200, {
      ok: true,
      id: buchung.id,
      weiterleitung: terminart.weiterleitung_url || null,
    });
  } catch (fehler) {
    if (fehler instanceof SlotVergeben) {
      return json(409, { fehler: 'Diese Uhrzeit wurde gerade vergeben. Bitte wähl einen anderen Slot.', slotWeg: true });
    }
    console.error('Buchung fehlgeschlagen', fehler);
    return json(500, { fehler: 'Die Buchung hat nicht geklappt. Bitte versuch es noch einmal oder schreib uns an info@thatsit.marketing.' });
  }
};
