/**
 * Zentraler CRM Webhook: jede Buchung, Absage und Playbook Anfrage geht an den Close Automat
 * (Worker thatsit-close-automat im Repo thatsit_homepage_new, Ordner close-automat/). Er legt
 * Lead, Felder, Activities und Aufgaben in Close an. Unabhängig vom Webhook je Nutzer unter
 * Integrationen, der bleibt für eigene Zwecke frei.
 *
 * Signatur wie beim Nutzer Webhook: x-letsmeet-signatur = HMAC-SHA256(CRM_WEBHOOK_SECRET, Body), hex.
 * Ohne CRM_WEBHOOK_URL oder CRM_WEBHOOK_SECRET passiert nichts. Wirft nie: ein Ausfall des
 * CRM darf keine Buchung kosten. Der Automat merkt sich Ereignisse, die er nicht verarbeiten
 * konnte, und holt sie per Cron nach.
 */
import { env } from 'cloudflare:workers';

export async function crmMelden(ereignis: string, daten: Record<string, unknown>) {
  const url = (env.CRM_WEBHOOK_URL ?? '').trim();
  const geheim = (env.CRM_WEBHOOK_SECRET ?? '').trim();
  if (!url || !geheim) return;
  const koerper = JSON.stringify({ ereignis, erstellt_am: new Date().toISOString(), daten });
  const schluessel = await crypto.subtle.importKey('raw', new TextEncoder().encode(geheim), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', schluessel, new TextEncoder().encode(koerper));
  const signatur = Array.from(new Uint8Array(sig), (x) => x.toString(16).padStart(2, '0')).join('');
  for (let versuch = 0; versuch < 2; versuch++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': "Let's Meet Webhook", 'x-letsmeet-signatur': signatur },
        body: koerper,
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok || res.status === 202) return;
      console.error('CRM Webhook antwortet mit', res.status, (await res.text()).slice(0, 300));
      if (res.status < 500) return;
    } catch (fehler) {
      console.error('CRM Webhook fehlgeschlagen', fehler);
    }
  }
}
