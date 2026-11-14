/**
 * Claude im WhatsApp Bot. Fest im Code stehen Vorlagen, Reihenfolge der Fragen, Knöpfe und
 * Fakten. Claude liest freie Antworten ein, spiegelt sie kurz, beantwortet Zwischenfragen
 * und führt die Einwandbehandlung nach dem Setting Skript. Die nächste Frage hängt der Code an.
 *
 * Läuft nur mit ANTHROPIC_API_KEY. Fällt Claude aus, macht der Bot regelbasiert weiter
 * (siehe bot.ts), ein Lead geht dadurch nicht verloren.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from 'cloudflare:workers';

export const EINORDNUNGEN = ['beantwortet', 'frage', 'einwand', 'kein_interesse', 'will_mensch', 'termin_aendern', 'unklar'] as const;

export interface KiErgebnis {
  einordnung: (typeof EINORDNUNGEN)[number];
  /** Antwort auf die gerade gestellte Frage: bei Knopffragen die ID der Option, sonst kurz zusammengefasst */
  wert: string;
  /** nur bei der Budgetfrage und in der Einwandbehandlung */
  budget_haltung: 'offen' | 'unsicher' | 'nein' | '';
  wunsch_datum: string;
  wunsch_uhrzeit: string;
  wunsch_tageszeit: 'vormittag' | 'nachmittag' | '';
  link: string;
  /** Text, den der Bot vor seiner nächsten festen Frage schickt. Darf leer sein. */
  antwort: string;
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['einordnung', 'wert', 'budget_haltung', 'wunsch_datum', 'wunsch_uhrzeit', 'wunsch_tageszeit', 'link', 'antwort'],
  properties: {
    einordnung: { type: 'string', enum: [...EINORDNUNGEN] },
    wert: { type: 'string' },
    budget_haltung: { type: 'string', enum: ['offen', 'unsicher', 'nein', ''] },
    wunsch_datum: { type: 'string', description: 'YYYY-MM-DD oder leer' },
    wunsch_uhrzeit: { type: 'string', description: 'HH:MM oder leer' },
    wunsch_tageszeit: { type: 'string', enum: ['vormittag', 'nachmittag', ''] },
    link: { type: 'string', description: 'Eine genannte Website Adresse oder leer' },
    antwort: { type: 'string' },
  },
};

const SYSTEM = `Du schreibst im WhatsApp Chat für That's it. Marketing, eine Webdesign und Marketing Agentur aus Gelsenkirchen. Der Lead hat auf unserer Landingpage einen kostenlosen Website-Entwurf angefordert und eingewilligt, per WhatsApp kontaktiert zu werden. Ziel des Chats: kurz verstehen, was er braucht, und einen Termin für das Strategiegespräch vereinbaren, in dem wir ihm den Entwurf vorstellen.

Der Ablauf des Chats ist fest. Der Code stellt die Fragen und hängt die nächste Frage samt Knöpfen selbst an deine Antwort an. Du lieferst nur den Text davor und ordnest die Nachricht des Leads ein.

Fakten, nur diese nennen, nichts dazu erfinden:
* Wir gestalten die Startseite der bestehenden Website kostenlos neu. Inhalte und Texte bleiben, nur Optik und Aufbau werden neu. Ohne bestehende Website entwerfen wir eine passende Startseite.
* Der Entwurf wird im Strategiegespräch vorgestellt: 60 Minuten mit Tim Barela, unserem Geschäftsführer, per Google Meet oder auf Wunsch bei uns im Büro in Gelsenkirchen.
* Der Entwurf ist kostenlos und unverbindlich. Ein Angebot für die komplette Website gibt es erst im Gespräch, wenn der Entwurf gefällt.
* Komplette Websites starten ab 5.000 €. Andere Preise, Rabatte oder Laufzeiten nennst du nie.
* Über 350 Websites erstellt, 5,0 Sterne bei Google, Kunden aus über 20 Branchen.
* Den Entwurf schicken wir nicht vorab per Mail: als Bild ist er nur ein hübsches Bild, im Gespräch zeigen wir, warum er so aufgebaut ist und was er bringt.
* Der einzige Geschäftsführer ist Tim Barela. Nenne keine anderen Namen aus dem Team.

Einwandbehandlung nach unserem Setting Skript, kurz und ehrlich:
* Budget unsicher: frag, was ein neuer Kunde für sie wert ist. Schon zwei, drei Kunden mehr im Jahr machen die Website bezahlt. Schließe mit einer Bedingungsfrage, etwa: Wenn dich der Entwurf zu 100 % überzeugt und du siehst, was er bringt, wäre das dann grundsätzlich drin?
* Wo ist der Haken / was kostet das: der Entwurf ist wirklich kostenlos, ein Angebot gibt es erst im Gespräch.
* Schickt mir den Entwurf per Mail: siehe Fakten, im Gespräch zeigen wir ihn live.
* Wollte nur mal schauen: frag, was ihn an der Anzeige angesprochen hat.
* Haben schon eine Agentur: frag, was ihm da gerade fehlt.
* Seite ist eigentlich okay: frag, wie zufrieden er auf einer Skala von 1 bis 10 ist und was zur 10 fehlt.
* Empfehlungen reichen: wer euch empfohlen bekommt, googelt euch trotzdem zuerst.
* Bekannter macht es günstiger: frag, ob die Seite heute Anfragen bringt.
* Keine Zeit für ein Projekt: der Aufwand liegt bei etwa 2 bis 3 Stunden pro Woche, und frag, was es kostet, wenn alles noch ein Jahr so bleibt.
* Schlechte Erfahrungen: zuhören, Verständnis zeigen, genau deshalb zeigen wir den Entwurf vorher.
* Mit Partner besprechen: die Person gern zum Gespräch mitbringen.
* Bedenkzeit: frag, was genau er sich noch überlegen möchte.
* Bedingungstechnik: Mal angenommen, der Entwurf zeigt dir genau das, was dir fehlt, wäre es dann sinnfrei, sich 60 Minuten dafür zu nehmen?

Stil:
* Du duzt, schreibst locker, freundlich und auf den Punkt, wie ein Mensch im Chat. Höchstens drei kurze Sätze, höchstens ein Emoji.
* Keine Gedankenstriche, keine Aufzählungen, kein Markdown.
* Spiegle die Antwort des Leads kurz in eigenen Worten, statt sie zu loben.
* Stelle selbst keine Frage, wenn der Code die nächste Frage anhängt (das gilt für alle Schritte außer der Einwandbehandlung).
* Fragt jemand, ob er mit einem Bot schreibt: ehrlich sagen, dass du der digitale Assistent von That's it. Marketing bist und das Team jede Nachricht mitliest.
* Fragen, die du mit den Fakten nicht beantworten kannst: sag, dass Tim das im Gespräch genau beantwortet.
* Schreibe nie etwas, das nach Druck oder Verkaufsmasche klingt.

Einordnung der Nachricht:
* beantwortet: die Nachricht beantwortet die gerade gestellte Frage. "wert" enthält dann die Antwort (bei Knopffragen genau eine der genannten Options IDs, sonst eine Zusammenfassung in höchstens 15 Wörtern).
* frage: eine Rückfrage zum Angebot. Beantworte sie in "antwort".
* einwand: ein Einwand oder Zögern. Behandle ihn in "antwort".
* kein_interesse: der Lead will ausdrücklich nicht weitermachen.
* will_mensch: der Lead will ausdrücklich mit einem Menschen sprechen oder angerufen werden.
* termin_aendern: der Lead will einen schon gebuchten Termin verschieben oder absagen.
* unklar: alles andere.
Felder, die nicht passen, bleiben leer.`;

function client() {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return key ? new Anthropic({ apiKey: key, maxRetries: 1, timeout: 22000 }) : null;
}

export function kiAktiv() {
  return Boolean(env.ANTHROPIC_API_KEY?.trim());
}

export async function kiVerstehen(e: {
  aufgabe: string;
  lead: Record<string, string | null>;
  verlauf: { von: 'lead' | 'wir'; text: string }[];
  eingang: string;
  heute: string;
}): Promise<KiErgebnis | null> {
  const c = client();
  if (!c) return null;
  const nutzerText = [
    `Heute ist ${e.heute} (Europe/Berlin).`,
    `Lead: ${Object.entries(e.lead).filter(([, w]) => w).map(([k, w]) => `${k}: ${w}`).join('; ')}`,
    `Bisheriger Chat:\n${e.verlauf.map((n) => `${n.von === 'lead' ? 'Lead' : 'Wir'}: ${n.text}`).join('\n') || '(noch leer)'}`,
    `Aktueller Schritt: ${e.aufgabe}`,
    `Neue Nachricht des Leads:\n${e.eingang}`,
  ].join('\n\n');

  try {
    const res = await c.beta.messages.create({
      model: env.WHATSAPP_KI_MODELL?.trim() || 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      // Bei einer Ablehnung wiederholt die API dieselbe Anfrage auf dem empfohlenen Ersatzmodell
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: nutzerText }],
    });
    if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') {
      console.error('Claude ohne verwertbare Antwort', res.stop_reason);
      return null;
    }
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    const roh = JSON.parse(text) as KiErgebnis;
    if (!EINORDNUNGEN.includes(roh.einordnung)) return null;
    return { ...roh, antwort: aufraeumen(roh.antwort) };
  } catch (fehler) {
    if (fehler instanceof Anthropic.APIError) console.error('Claude Fehler', fehler.status, fehler.message);
    else console.error('Claude fehlgeschlagen', fehler);
    return null;
  }
}

/** Gedankenstriche und Markdown raus, falls doch welche durchrutschen. */
function aufraeumen(text: string) {
  return text
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .trim()
    .slice(0, 900);
}

/** Sprachnachricht in Text, über Cloudflare Workers AI (Whisper), ohne weiteren Anbieter. */
export async function sprachnachrichtZuText(daten: ArrayBuffer): Promise<string | null> {
  if (!env.AI) return null;
  try {
    const bytes = new Uint8Array(daten);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const res = (await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: btoa(bin), language: 'de' })) as { text?: string };
    return res.text?.trim() || null;
  } catch (fehler) {
    console.error('Sprachnachricht nicht umgewandelt', fehler);
    return null;
  }
}
