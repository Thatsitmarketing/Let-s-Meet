/**
 * WhatsApp Cloud API von Meta: Nachrichten, Vorlagen, Lesebestätigung, Sprachnachrichten
 * herunterladen und die Signatur des Webhooks prüfen. Keine Bibliothek, nur fetch.
 *
 * Ohne WHATSAPP_TOKEN und WHATSAPP_PHONE_NUMBER_ID wird nichts gesendet, nur protokolliert
 * (lokale Entwicklung), genau wie die Mails ohne RESEND_API_KEY.
 */
import { env } from 'cloudflare:workers';
import { schluesselGleich } from '../playbooks';

const version = () => (env.WHATSAPP_API_VERSION || 'v24.0').trim();
const graph = (pfad: string) => `https://graph.facebook.com/${version()}/${pfad}`;

export function waAktiv() {
  return Boolean(env.WHATSAPP_TOKEN?.trim() && env.WHATSAPP_PHONE_NUMBER_ID?.trim());
}

export interface Knopf {
  id: string;
  /** höchstens 20 Zeichen, sonst lehnt Meta die Nachricht ab */
  titel: string;
}

/** Aus "+49 170 1234567" wird "491701234567", das Format, in dem Meta die Nummern führt. */
export function waNummer(telefon: string) {
  return telefon.replace(/\D/g, '').replace(/^00/, '');
}

async function senden(koerper: Record<string, unknown>): Promise<string | null> {
  if (!waAktiv()) {
    console.log('[WhatsApp nicht gesendet, Zugang fehlt]', JSON.stringify(koerper).slice(0, 400));
    return null;
  }
  const res = await fetch(graph(`${env.WHATSAPP_PHONE_NUMBER_ID!.trim()}/messages`), {
    method: 'POST',
    headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN!.trim()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...koerper }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${text.slice(0, 500)}`);
  try {
    return (JSON.parse(text) as { messages?: { id: string }[] }).messages?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

export function sendeText(an: string, text: string) {
  return senden({ recipient_type: 'individual', to: an, type: 'text', text: { body: text.slice(0, 4096), preview_url: false } });
}

/** Text mit bis zu drei Antwortknöpfen. Ohne Knöpfe wird es eine normale Textnachricht. */
export function sendeKnoepfe(an: string, text: string, knoepfe: Knopf[]) {
  if (!knoepfe.length) return sendeText(an, text);
  return senden({
    recipient_type: 'individual',
    to: an,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: text.slice(0, 1024) },
      action: {
        buttons: knoepfe.slice(0, 3).map((k) => ({ type: 'reply', reply: { id: k.id.slice(0, 256), title: k.titel.slice(0, 20) } })),
      },
    },
  });
}

/**
 * Freigegebene Vorlage, nötig für die erste Nachricht und alles außerhalb des 24 Stunden Fensters.
 * `knoepfe` sind die Payloads der Schnellantwortknöpfe in der Reihenfolge der Vorlage.
 */
export function sendeVorlage(an: string, name: string, parameter: string[], knoepfe: string[] = []) {
  const components: Record<string, unknown>[] = [];
  if (parameter.length) components.push({ type: 'body', parameters: parameter.map((p) => ({ type: 'text', text: p })) });
  knoepfe.forEach((payload, index) =>
    components.push({ type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload }] }),
  );
  return senden({ to: an, type: 'template', template: { name, language: { code: env.WHATSAPP_VORLAGEN_SPRACHE || 'de' }, components } });
}

/** Blaue Haken und "schreibt ..." anzeigen, während Claude antwortet. Fehler sind egal. */
export async function gelesenUndTippt(messageId: string) {
  if (!waAktiv()) return;
  await senden({ status: 'read', message_id: messageId, typing_indicator: { type: 'text' } }).catch((f) =>
    console.error('Lesebestätigung fehlgeschlagen', f),
  );
}

/** Sprachnachricht oder andere Datei von Meta laden (zwei Schritte: URL holen, dann Datei). */
export async function medienLaden(mediaId: string, maxBytes = Infinity): Promise<{ daten: ArrayBuffer; mime: string } | null> {
  if (!waAktiv()) return null;
  const kopf = { authorization: `Bearer ${env.WHATSAPP_TOKEN!.trim()}` };
  const info = await fetch(graph(mediaId), { headers: kopf, signal: AbortSignal.timeout(10000) });
  if (!info.ok) throw new Error(`Medien Info ${info.status}`);
  const { url, mime_type, file_size } = (await info.json()) as { url: string; mime_type: string; file_size?: number };
  // Zu große Dateien gar nicht erst laden
  if (file_size && file_size > maxBytes) return null;
  // Nur von Meta laden, nie von einer anderen Adresse
  if (!/^https:\/\/[a-z0-9.-]+\.(fbsbx|facebook|whatsapp)\.(com|net)\//i.test(url)) throw new Error('Unerwartete Medienadresse');
  const datei = await fetch(url, { headers: kopf, signal: AbortSignal.timeout(20000) });
  if (!datei.ok) throw new Error(`Medien Download ${datei.status}`);
  const daten = await datei.arrayBuffer();
  if (daten.byteLength > maxBytes) return null;
  return { daten, mime: mime_type };
}

/** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(App Secret, roher Body) */
export async function signaturGueltig(roh: string, kopf: string | null) {
  const geheim = env.WHATSAPP_APP_SECRET?.trim();
  if (!geheim || !kopf?.startsWith('sha256=')) return false;
  const schluessel = await crypto.subtle.importKey('raw', new TextEncoder().encode(geheim), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', schluessel, new TextEncoder().encode(roh));
  const hex = Array.from(new Uint8Array(sig), (x) => x.toString(16).padStart(2, '0')).join('');
  return schluesselGleich(hex, kopf.slice(7).toLowerCase());
}
