/**
 * Serverseitiger Austausch des Embedded Signup Codes gegen den WhatsApp Business Token (Meta).
 * Aufgerufen von /app/whatsapp/coexistence.astro, nachdem FB.login() im Browser den Code geliefert
 * hat. Der Code lebt nur 5 Minuten und wird server-to-server eingetauscht, nie im Browser.
 * POST JSON { code, waba_id?, phone_number_id?, business_id? }, nur angemeldet und nur Admin.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { json, trimmen } from '../../../../lib/eingabe';

const version = () => (env.WHATSAPP_API_VERSION || 'v24.0').trim();
const graph = (pfad: string) => `https://graph.facebook.com/${version()}/${pfad}`;

interface Eintausch {
  access_token: string;
  token_type: string;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const nutzer = locals.nutzer!;
  if (nutzer.rolle !== 'admin') return json(403, { fehler: 'Nur für Admins' });

  const appId = env.WHATSAPP_APP_ID?.trim();
  const appSecret = env.WHATSAPP_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    return json(500, { fehler: 'WHATSAPP_APP_ID oder WHATSAPP_APP_SECRET fehlt im Worker. Bitte in Cloudflare setzen.' });
  }

  let d: Record<string, unknown>;
  try {
    d = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { fehler: 'Ungültige Anfrage' });
  }
  const code = trimmen(d.code, 2000);
  const wabaId = trimmen(d.waba_id, 60);
  const phoneNumberId = trimmen(d.phone_number_id, 60);
  const businessId = trimmen(d.business_id, 60);
  if (!code) return json(422, { fehler: 'Kein Code von Meta erhalten. Bitte die Verbindung noch einmal starten.' });

  // Schritt 1: Code gegen den dauerhaften Business Token eintauschen (server to server, GET)
  const tauschUrl = new URL(graph('oauth/access_token'));
  tauschUrl.searchParams.set('client_id', appId);
  tauschUrl.searchParams.set('client_secret', appSecret);
  tauschUrl.searchParams.set('code', code);

  let eintausch: Eintausch;
  try {
    const res = await fetch(tauschUrl, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    if (!res.ok) {
      console.error('[WhatsApp Coexistence] Code Eintausch fehlgeschlagen', res.status, text.slice(0, 500));
      return json(502, { fehler: `Meta hat den Code abgelehnt (${res.status}). Oft ist der Code schon abgelaufen (5 Minuten gültig) oder schon benutzt, einfach noch einmal starten. Antwort: ${text.slice(0, 300)}` });
    }
    eintausch = JSON.parse(text) as Eintausch;
  } catch (f) {
    console.error('[WhatsApp Coexistence] Code Eintausch fehlgeschlagen', f);
    return json(502, { fehler: 'Keine Verbindung zu Meta. Bitte noch einmal versuchen.' });
  }
  if (!eintausch.access_token) {
    return json(502, { fehler: 'Meta hat keinen Token geliefert.' });
  }
  // Der Token selbst geht nie ins Protokoll und nie zurück an den Browser, nur das Ergebnis
  console.log('[WhatsApp Coexistence] Business Token erhalten', { waba_id: wabaId, phone_number_id: phoneNumberId, business_id: businessId, von: nutzer.email });

  // Schritt 2: App an der Messaging Nummer anmelden (subscribed_apps), sonst kommen keine Webhooks an
  let abonniert = false;
  let abonniertFehler = '';
  if (wabaId) {
    try {
      const res = await fetch(graph(`${wabaId}/subscribed_apps`), {
        method: 'POST',
        headers: { authorization: `Bearer ${eintausch.access_token}` },
        signal: AbortSignal.timeout(10000),
      });
      const text = await res.text();
      if (res.ok) abonniert = true;
      else abonniertFehler = `Status ${res.status}: ${text.slice(0, 300)}`;
    } catch (f) {
      abonniertFehler = f instanceof Error ? f.message : 'Unbekannter Fehler';
    }
  }

  return json(200, {
    ok: true,
    waba_id: wabaId || null,
    phone_number_id: phoneNumberId || null,
    business_id: businessId || null,
    abonniert,
    abonniert_fehler: abonniertFehler || null,
  });
};
