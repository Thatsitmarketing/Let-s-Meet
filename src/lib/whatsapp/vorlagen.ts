/**
 * Nachrichtenvorlagen des WhatsApp Bots bei Meta: einreichen und Status abfragen.
 * Grundlage der Seite /app/whatsapp/vorlagen.
 *
 * Die Texte kommen aus TEXTE in bot.ts (mit {{1}}, {{2}} statt echter Werte), die Namen aus
 * VORLAGEN. So steht jeder Text nur an einer Stelle: ändert sich ein Text in TEXTE, wird bei Meta
 * genau dieser eingereicht. Eine schon freigegebene Vorlage lässt sich bei Meta nicht unter
 * demselben Namen neu einreichen, dann zeigt die Seite "Text weicht ab".
 *
 * Braucht WHATSAPP_TOKEN mit whatsapp_business_management und die ID des WhatsApp Business
 * Kontos (WABA), Standard aus der Variable WHATSAPP_WABA_ID.
 */
import { env } from 'cloudflare:workers';
import { TEXTE, VORLAGEN } from './bot';

const version = () => (env.WHATSAPP_API_VERSION || 'v24.0').trim();
const graph = (pfad: string) => `https://graph.facebook.com/${version()}/${pfad}`;
const sprache = () => (env.WHATSAPP_VORLAGEN_SPRACHE || 'de').trim();

export type Kategorie = 'MARKETING' | 'UTILITY';

export interface VorlageDefinition {
  name: string;
  zweck: string;
  kategorie: Kategorie;
  text: string;
  beispiele: string[];
  knoepfe: string[];
}

/** Die vier Vorlagen des Bots, Reihenfolge der Knöpfe wie die Payloads in VORLAGEN. */
export const VORLAGEN_DEFINITION: VorlageDefinition[] = [
  {
    name: VORLAGEN.startWebsite.name,
    zweck: 'Erste Nachricht an einen Lead mit Website',
    kategorie: 'MARKETING',
    text: TEXTE.startWebsite('{{1}}', '{{2}}'),
    beispiele: ['Max', 'Testbau GmbH'],
    knoepfe: ['Wirkt veraltet', 'Bringt kaum Anfragen', 'Etwas anderes'],
  },
  {
    name: VORLAGEN.startOhne.name,
    zweck: 'Erste Nachricht an einen Lead ohne Website',
    kategorie: 'MARKETING',
    text: TEXTE.startOhne('{{1}}', '{{2}}'),
    beispiele: ['Max', 'Testbau GmbH'],
    knoepfe: ['Über Empfehlungen', 'Über Social Media', 'Anders'],
  },
  {
    name: VORLAGEN.nachfass.name,
    zweck: 'Nachfassen, wenn nach 3 Stunden keine Antwort kam',
    kategorie: 'MARKETING',
    text: TEXTE.nachfass('{{1}}'),
    beispiele: ['Max'],
    knoepfe: ["Ja, los geht's", 'Später'],
  },
  {
    name: VORLAGEN.erinnerung.name,
    zweck: 'Erinnerung am Vortag des Termins',
    kategorie: 'UTILITY',
    text: TEXTE.erinnerung('{{1}}', '{{2}}'),
    beispiele: ['Max', '23. November um 09:00 Uhr'],
    knoepfe: [],
  },
];

export interface MetaVorlage {
  id: string;
  name: string;
  status: string;
  category?: string;
  language?: string;
  rejected_reason?: string;
  components?: { type: string; text?: string; buttons?: { type: string; text: string }[] }[];
}

export function wabaStandard() {
  return env.WHATSAPP_WABA_ID?.trim() || '';
}

export function wabaGueltig(waba: string) {
  return /^\d{5,30}$/.test(waba);
}

function token() {
  const t = env.WHATSAPP_TOKEN?.trim();
  if (!t) throw new Error('WHATSAPP_TOKEN fehlt im Worker. Bitte in Cloudflare als Secret setzen.');
  return t;
}

async function metaFehler(res: Response) {
  const text = await res.text();
  try {
    const f = (JSON.parse(text) as { error?: { message?: string; error_user_msg?: string; error_user_title?: string } }).error;
    const teile = [f?.error_user_title, f?.error_user_msg || f?.message].filter(Boolean);
    if (teile.length) return `Meta ${res.status}: ${teile.join(': ')}`;
  } catch {
    // keine JSON Antwort
  }
  return `Meta ${res.status}: ${text.slice(0, 300)}`;
}

/** Alle Vorlagen des Kontos in der Sprache des Bots. */
export async function vorlagenLaden(waba: string): Promise<MetaVorlage[]> {
  const url = new URL(graph(`${waba}/message_templates`));
  url.searchParams.set('fields', 'name,status,category,language,rejected_reason,components');
  url.searchParams.set('limit', '200');
  const res = await fetch(url, { headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(await metaFehler(res));
  const daten = (await res.json()) as { data?: MetaVorlage[] };
  return (daten.data ?? []).filter((v) => !v.language || v.language === sprache());
}

/** Reicht eine Vorlage bei Meta zur Prüfung ein. Gibt den Status zurück (meist PENDING). */
export async function vorlageEinreichen(waba: string, d: VorlageDefinition): Promise<string> {
  const components: Record<string, unknown>[] = [
    { type: 'BODY', text: d.text, example: { body_text: [d.beispiele] } },
  ];
  if (d.knoepfe.length) {
    components.push({ type: 'BUTTONS', buttons: d.knoepfe.map((text) => ({ type: 'QUICK_REPLY', text })) });
  }
  const res = await fetch(graph(`${waba}/message_templates`), {
    method: 'POST',
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: d.name, language: sprache(), category: d.kategorie, components }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(await metaFehler(res));
  const daten = (await res.json()) as { status?: string };
  return daten.status ?? 'PENDING';
}

/** Stimmt die Vorlage bei Meta in Text und Knöpfen mit unserer überein? */
export function textGleich(d: VorlageDefinition, m: MetaVorlage) {
  const body = m.components?.find((c) => c.type === 'BODY')?.text ?? '';
  const knoepfe = m.components?.find((c) => c.type === 'BUTTONS')?.buttons?.map((b) => b.text) ?? [];
  return body === d.text && knoepfe.join('|') === d.knoepfe.join('|');
}

export const STATUS_TEXT: Record<string, string> = {
  APPROVED: 'Freigegeben',
  PENDING: 'In Prüfung',
  IN_APPEAL: 'Einspruch läuft',
  REJECTED: 'Abgelehnt',
  PAUSED: 'Pausiert',
  DISABLED: 'Deaktiviert',
  PENDING_DELETION: 'Wird gelöscht',
  LIMIT_EXCEEDED: 'Limit erreicht',
};
