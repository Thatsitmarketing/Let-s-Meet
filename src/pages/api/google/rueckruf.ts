import type { APIRoute } from 'astro';
import { signaturPruefen } from '../../../lib/auth';
import { ausfuehren, jetztIso } from '../../../lib/db';
import { googleCodeTauschen } from '../../../lib/google';

/**
 * Rückruf von Google. Liegt bewusst außerhalb von /api/app, weil das Sitzungscookie
 * SameSite=Strict ist und bei der Rückleitung von Google nicht mitgeschickt wird.
 * Die Zuordnung zum Nutzer kommt aus dem signierten, zehn Minuten gültigen state.
 */
export const GET: APIRoute = async ({ url, redirect }) => {
  const code = url.searchParams.get('code');
  const state = await signaturPruefen(url.searchParams.get('state') ?? '', 'oauth').catch(() => null);
  const [id, ablauf] = (state ?? '').split('|');
  if (!code || !id || Number(ablauf) < Date.now()) return redirect('/app/integrationen?google_fehler=1');
  try {
    const t = await googleCodeTauschen(code, `${url.origin}/api/google/rueckruf`);
    if (!t.refresh_token) return redirect('/app/integrationen?google_fehler=1');
    await ausfuehren(
      `UPDATE nutzer SET google_email = ?, google_refresh_token = ?, google_access_token = ?, google_token_ablauf = ?, aktualisiert_am = ? WHERE id = ?`,
      t.email, t.refresh_token, t.access_token, Date.now() + t.expires_in * 1000, jetztIso(), id,
    );
    return redirect('/app/integrationen?ok=google');
  } catch (fehler) {
    console.error('Google Verbindung fehlgeschlagen', fehler);
    return redirect('/app/integrationen?google_fehler=1');
  }
};
