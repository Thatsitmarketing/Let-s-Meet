import type { APIRoute } from 'astro';
import { signaturPruefen } from '../../../lib/auth';
import { ausfuehren, eins, jetztIso } from '../../../lib/db';
import { GoogleTokenFehler, googleAbgleich, googleCodeTauschen, googleTermineEntfernen } from '../../../lib/google';
import type { Nutzer } from '../../../lib/typen';

/**
 * Rückruf von Google. Liegt bewusst außerhalb von /api/app, weil das Sitzungscookie
 * SameSite=Strict ist und bei der Rückleitung von Google nicht mitgeschickt wird.
 * Die Zuordnung zum Nutzer kommt aus dem signierten, zehn Minuten gültigen state.
 */
export const GET: APIRoute = async ({ url }) => {
  const googleFehler = url.searchParams.get('error');
  if (googleFehler) return weiterleiten(`/app/integrationen?google_fehler=${googleFehler === 'access_denied' ? 'abgelehnt' : 'google'}`);

  const code = url.searchParams.get('code');
  const state = await signaturPruefen(url.searchParams.get('state') ?? '', 'oauth').catch(() => null);
  const [id, ablauf] = (state ?? '').split('|');
  if (!code || !id || Number(ablauf) < Date.now()) return weiterleiten('/app/integrationen?google_fehler=state');

  try {
    const t = await googleCodeTauschen(code, `${url.origin}/api/google/rueckruf`);
    if (!t.refresh_token) return weiterleiten('/app/integrationen?google_fehler=kein_refresh');
    const ergebnis = await ausfuehren(
      `UPDATE nutzer SET google_email = ?, google_refresh_token = ?, google_access_token = ?, google_token_ablauf = ?, aktualisiert_am = ? WHERE id = ?`,
      t.email, t.refresh_token, t.access_token, Date.now() + t.expires_in * 1000, jetztIso(), id,
    );
    if (!ergebnis.meta.changes) return weiterleiten('/app/integrationen?google_fehler=speichern');
    // Termine sofort übernehmen, alte Einträge eines vorher verbundenen Kontos fallen weg
    const nutzer = await eins<Nutzer>('SELECT * FROM nutzer WHERE id = ?', id);
    if (nutzer) {
      await googleTermineEntfernen(nutzer.id).catch(() => null);
      await googleAbgleich(nutzer);
    }
    return weiterleiten('/app/integrationen?ok=google');
  } catch (fehler) {
    console.error('Google Verbindung fehlgeschlagen', fehler);
    const grund = fehler instanceof GoogleTokenFehler ? fehler.code : 'speichern';
    return weiterleiten(`/app/integrationen?google_fehler=${encodeURIComponent(grund)}`);
  }
};

/**
 * Leitet über eine kleine Seite statt per 302 weiter. Bei einem 302 zählt die Navigation
 * noch als von Google ausgelöst, das Strict Cookie fehlt und man landet auf dem Login.
 * Die Weiterleitung per meta refresh startet auf unserer Domain, dann kommt das Cookie mit.
 */
function weiterleiten(ziel: string) {
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${ziel}"><title>Weiterleitung</title></head><body style="font-family:sans-serif;padding:2rem"><p>Einen Moment, du wirst weitergeleitet. <a href="${ziel}">Weiter</a></p></body></html>`;
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
