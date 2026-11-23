/**
 * Zuordnung von Chats, die ein Interessent selbst beginnt (seit 2026-11-23).
 *
 * Die Landingpage Website Entwurf bietet nach dem Funnel "Per WhatsApp" (Lead mit Einwilligung über
 * /api/whatsapp/lead) oder "Per Anruf". Wer Anruf wählt, bekommt auf der Dankesseite und in der Mail
 * einen Knopf, der WhatsApp mit diesem Text öffnet:
 *   "Hallo, ich habe gerade meinen kostenlosen Website-Entwurf angefragt (Anfrage XXXXXX). Gerne per WhatsApp weiter."
 * Die Anfragenummer steht in `anfragen.antworten` ({ frage: 'Anfragenummer', antwort: 'XXXXXX' }).
 *
 * Gesucht wird zuerst über die Absendernummer (gegen die Telefonnummer der Anfrage), sonst über die
 * Anfragenummer im Text. Diese Datei hängt bewusst nicht an `cloudflare:workers`: die Abfrage kommt
 * als Funktion herein, damit die Tests (tests/zuordnung.test.ts) dieselbe SQL gegen SQLite prüfen.
 */

/** Alphabet der Anfragenummer: ohne I, L, O, 0 und 1, damit nichts verwechselt wird */
export const ANFRAGENUMMER_ZEICHEN = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** "Anfrage XXXXXX", auch "Anfrage: XXXXXX", "Anfragenummer XXXXXX" oder "(Anfrage Nr. XXXXXX)" */
const ANFRAGENUMMER = /(?:^|[^A-Za-zÄÖÜäöü])[Aa]nfrage(?:[Nn]ummer|\s*[Nn]r\.?)?\s*:?\s*([A-HJKMNP-Z2-9]{6})(?![A-Za-z0-9])/;

/** Erkennt den vorausgefüllten Text, auch wenn jemand die Nummer gelöscht oder vertippt hat */
const ENTWURF_TEXT = /website[\s-]?entwurf/i;

/** Wie lange eine Anfrage über die Absendernummer bzw. die Anfragenummer gefunden wird */
export const NUMMER_TAGE = 30;
export const ANFRAGENUMMER_TAGE = 90;

export function anfragenummerAusText(text: string): string | null {
  return text.match(ANFRAGENUMMER)?.[1] ?? null;
}

/** Text gehört erkennbar zur Landingpage Website Entwurf (mit oder ohne gültige Nummer) */
export function istEntwurfNachricht(text: string) {
  return ANFRAGENUMMER.test(text) || ENTWURF_TEXT.test(text);
}

/**
 * Telefonnummer so, wie Meta sie als wa_id führt (Ziffern mit Ländervorwahl, ohne +).
 * "+49 170 1234567", "0049 170 1234567" und "0170 1234567" ergeben alle "491701234567".
 * Nummern ohne Ländervorwahl gelten als deutsch, wie im Formular der Landingpage.
 */
export function telefonNorm(roh: string | null | undefined) {
  const ziffern = (roh ?? '').replace(/\D/g, '');
  if (!ziffern) return '';
  if (ziffern.startsWith('00')) return ziffern.slice(2);
  if ((roh ?? '').trim().startsWith('+')) return ziffern;
  if (ziffern.startsWith('0')) return `49${ziffern.slice(1)}`;
  return ziffern;
}

export interface AnfrageTreffer {
  id: string;
  name: string;
  email: string;
  telefon: string | null;
  unternehmen: string | null;
  antworten: string | null;
  erstellt_am: string;
  whatsapp_gespraech_id: string | null;
}

export type Abfrage = <T>(sql: string, ...werte: (string | number | null)[]) => Promise<T[]>;

const SPALTEN = 'id, name, email, telefon, unternehmen, antworten, erstellt_am, whatsapp_gespraech_id';

/** Anfrage zur Absendernummer, neueste zuerst. Die Telefonnummern stehen roh in der D1, verglichen wird normalisiert. */
export async function anfrageZurNummer(abfrage: Abfrage, absender: string, jetzt = new Date()) {
  const ziel = telefonNorm(`+${absender.replace(/\D/g, '')}`);
  if (ziel.length < 8) return null;
  const seit = new Date(jetzt.getTime() - NUMMER_TAGE * 86_400_000).toISOString();
  const zeilen = await abfrage<AnfrageTreffer>(
    `SELECT ${SPALTEN} FROM anfragen WHERE quelle = 'website-entwurf' AND telefon IS NOT NULL AND erstellt_am >= ? ORDER BY erstellt_am DESC LIMIT 1000`,
    seit,
  );
  return zeilen.find((a) => telefonNorm(a.telefon) === ziel) ?? null;
}

/** Anfrage zur Anfragenummer (steht in den Antworten aus dem Funnel). */
export async function anfrageZurAnfragenummer(abfrage: Abfrage, nummer: string, jetzt = new Date()) {
  const seit = new Date(jetzt.getTime() - ANFRAGENUMMER_TAGE * 86_400_000).toISOString();
  const zeilen = await abfrage<AnfrageTreffer>(
    `SELECT ${SPALTEN} FROM anfragen a
     WHERE a.quelle = 'website-entwurf' AND a.erstellt_am >= ? AND a.antworten IS NOT NULL AND json_valid(a.antworten)
       AND EXISTS (SELECT 1 FROM json_each(a.antworten) j
                   WHERE json_extract(j.value, '$.frage') = 'Anfragenummer' AND upper(trim(json_extract(j.value, '$.antwort'))) = ?)
     ORDER BY a.erstellt_am DESC LIMIT 1`,
    seit,
    nummer.toUpperCase(),
  );
  return zeilen[0] ?? null;
}

export type Zuordnung =
  | { weg: 'nummer' | 'anfragenummer'; anfrage: AnfrageTreffer; anfragenummer: string | null }
  | { weg: 'keine'; anfrage: null; anfragenummer: string | null }
  | null;

/**
 * Sucht die Anfrage zu einem Chat, den der Interessent selbst begonnen hat.
 * null: die Nachricht hat nichts mit der Landingpage zu tun (normaler Kundenchat), der Bot schweigt.
 * weg "keine": die Nachricht gehört erkennbar zur Landingpage, aber keine Anfrage passt.
 */
export async function anfrageZuordnen(abfrage: Abfrage, absender: string, text: string, jetzt = new Date()): Promise<Zuordnung> {
  const anfragenummer = anfragenummerAusText(text);
  const perNummer = await anfrageZurNummer(abfrage, absender, jetzt);
  if (perNummer) return { weg: 'nummer', anfrage: perNummer, anfragenummer };
  if (anfragenummer) {
    const perText = await anfrageZurAnfragenummer(abfrage, anfragenummer, jetzt);
    if (perText) return { weg: 'anfragenummer', anfrage: perText, anfragenummer };
  }
  if (istEntwurfNachricht(text)) return { weg: 'keine', anfrage: null, anfragenummer };
  return null;
}

/** Angaben aus dem Funnel, die der Bot braucht (Website, ob es schon eine gibt, Anfragenummer) */
export function angabenDerAnfrage(a: Pick<AnfrageTreffer, 'antworten'>) {
  let liste: { frage?: unknown; antwort?: unknown }[] = [];
  try {
    const roh = JSON.parse(a.antworten || '[]');
    if (Array.isArray(roh)) liste = roh;
  } catch {
    /* defekte Daten: keine Angaben */
  }
  const wert = (frage: string) => {
    const t = liste.find((x) => typeof x?.frage === 'string' && x.frage.toLowerCase() === frage.toLowerCase())?.antwort;
    return typeof t === 'string' && t.trim() ? t.trim() : null;
  };
  const website = wert('Website');
  const hat = wert('Hat schon eine Website');
  const hatWebsite = hat ? !/^(nein|no|keine|noch keine)/i.test(hat) : Boolean(website);
  return { website, hatWebsite, anfragenummer: wert('Anfragenummer'), kontaktweg: wert('Kontaktweg') };
}
