/**
 * Webhook der WhatsApp Cloud API.
 * GET: Bestätigung beim Einrichten in Meta (hub.verify_token = WHATSAPP_VERIFY_TOKEN).
 * POST: Nachrichten (Feld "messages") und, bei der Coexistence mit der WhatsApp Business App,
 * Nachrichten des Teams aus der App (Feld "smb_message_echoes"). Signatur über WHATSAPP_APP_SECRET.
 * Meta bekommt sofort 200, die Antwort des Bots läuft danach im Hintergrund.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { sprachnachrichtZuText } from '../../../lib/whatsapp/ki';
import { eingangVerarbeiten, teamNachricht, type Eingang } from '../../../lib/whatsapp/bot';
import { medienLaden, signaturGueltig } from '../../../lib/whatsapp/meta';
import { schluesselGleich } from '../../../lib/playbooks';
import { MAX_AUDIO_BYTES } from '../../../lib/whatsapp/schutz';

const MAX_GESPEICHERT = 4000;

export const GET: APIRoute = ({ url }) => {
  const token = env.WHATSAPP_VERIFY_TOKEN?.trim();
  const p = url.searchParams;
  if (token && p.get('hub.mode') === 'subscribe' && schluesselGleich(p.get('hub.verify_token') ?? '', token)) {
    return new Response(p.get('hub.challenge') ?? '', { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return new Response('Nicht erlaubt', { status: 403 });
};

interface MetaNachricht {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  button?: { payload?: string; text?: string };
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
  audio?: { id: string };
}

interface MetaEcho {
  to: string;
  id: string;
  type: string;
  text?: { body: string };
}

async function eingangLesen(n: MetaNachricht): Promise<Eingang> {
  // Gespeichert wird höchstens MAX_GESPEICHERT Zeichen, an Claude geht noch weniger (schutz.ts)
  if (n.type === 'text') return { waId: n.id, art: 'text', text: (n.text?.body ?? '').slice(0, MAX_GESPEICHERT), knopf: null };
  if (n.type === 'button') return { waId: n.id, art: 'knopf', text: n.button?.text ?? '', knopf: n.button?.payload ?? null };
  if (n.type === 'interactive') {
    const r = n.interactive?.button_reply ?? n.interactive?.list_reply;
    return { waId: n.id, art: 'knopf', text: (r?.title ?? '').slice(0, 100), knopf: (r?.id ?? '').slice(0, 40) || null };
  }
  if (n.type === 'audio' && n.audio?.id) {
    const datei = await medienLaden(n.audio.id, MAX_AUDIO_BYTES).catch(() => null);
    // Sehr lange Aufnahmen werden nicht umgewandelt (Kosten), das Team sieht sie im Backoffice
    const text = datei && datei.daten.byteLength <= MAX_AUDIO_BYTES ? (await sprachnachrichtZuText(datei.daten))?.slice(0, MAX_GESPEICHERT) : null;
    return { waId: n.id, art: 'sprache', text: text ? `(Sprachnachricht) ${text}` : '(Sprachnachricht, nicht verständlich)', knopf: null };
  }
  return { waId: n.id, art: 'sonstiges', text: `(${n.type})`, knopf: null };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const roh = await request.text();
  if (!(await signaturGueltig(roh, request.headers.get('x-hub-signature-256')))) return new Response('Signatur ungültig', { status: 401 });

  let daten: { entry?: { changes?: { field: string; value: Record<string, unknown> }[] }[] };
  try {
    daten = JSON.parse(roh);
  } catch {
    return new Response('ok');
  }

  const arbeit = async () => {
    for (const eintrag of daten.entry ?? []) {
      for (const aenderung of eintrag.changes ?? []) {
        const wert = aenderung.value ?? {};
        if (aenderung.field === 'messages') {
          for (const n of (wert.messages as MetaNachricht[] | undefined) ?? []) {
            await eingangVerarbeiten(n.from, await eingangLesen(n)).catch((f) => console.error('WhatsApp Eingang', f));
          }
          for (const s of (wert.statuses as { status: string; recipient_id: string; errors?: unknown }[] | undefined) ?? []) {
            if (s.status === 'failed') console.error('WhatsApp Zustellung fehlgeschlagen', s.recipient_id, JSON.stringify(s.errors ?? ''));
          }
        } else if (aenderung.field === 'smb_message_echoes') {
          for (const e of (wert.message_echoes as MetaEcho[] | undefined) ?? []) {
            await teamNachricht(e.to, e.id, e.text?.body ?? `(${e.type})`).catch((f) => console.error('WhatsApp Echo', f));
          }
        }
      }
    }
  };
  locals.cfContext.waitUntil(arbeit());
  return new Response('ok');
};
