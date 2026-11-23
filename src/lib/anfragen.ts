/**
 * Anfragen über Landingpages, die keine Playbooks sind (seit 2026-11-16).
 *
 * Erste Quelle ist der Website Entwurf Funnel (Repo `ad_web_entwurf_landingpage`,
 * website-entwurf.thatsit.marketing). Dessen `/api/kontakt` ruft serverseitig
 * `POST /api/anfrage` mit Bearer `ANFRAGE_SCHLUESSEL`. Let's Meet legt Kontakt und Anfrage an,
 * zeigt sie unter `/app/anfragen` und meldet sie an den Close Automaten (`anfrage.eingegangen`).
 * Die Fragen bestimmt die Landingpage (`antworten`), angezeigt wird, was ankommt.
 */
import { env } from 'cloudflare:workers';
import { alle, ausfuehren, eins, jetztIso, neueId } from './db';
import { emailNorm, kontaktAusPlaybook } from './kontakte';
import { antwortenPruefen, schluesselGleich, type PlaybookAntwort } from './playbooks';

export const ANFRAGE_QUELLEN = {
  'website-entwurf': {
    name: 'Website Entwurf',
    landingpage: 'https://website-entwurf.thatsit.marketing',
  },
} as const;

export type AnfrageQuelle = keyof typeof ANFRAGE_QUELLEN;
export const istAnfrageQuelle = (w: unknown): w is AnfrageQuelle =>
  typeof w === 'string' && Object.hasOwn(ANFRAGE_QUELLEN, w);

/** Anfragen werden 12 Monate nach Eingang gelöscht (Cron) */
const AUFBEWAHRUNG_TAGE = 365;

export interface Anfrage {
  id: string;
  nutzer_id: string;
  kontakt_id: string | null;
  quelle: string;
  name: string;
  email: string;
  telefon: string | null;
  unternehmen: string | null;
  antworten: string | null;
  seite: string | null;
  dublette: number;
  /** Gespräch des WhatsApp Bots, wenn die Anfrage per WhatsApp übernommen wurde (seit 2026-11-23) */
  whatsapp_gespraech_id: string | null;
  whatsapp_am: string | null;
  erstellt_am: string;
}

/** Prüft den Bearer Schlüssel der Landingpage. Ohne gesetzten Schlüssel ist die Schnittstelle zu. */
export function anfrageBerechtigt(request: Request) {
  const geheim = env.ANFRAGE_SCHLUESSEL?.trim();
  if (!geheim || geheim.length < 24) return false;
  const kopf = request.headers.get('authorization') ?? '';
  const token = kopf.startsWith('Bearer ') ? kopf.slice(7).trim() : '';
  return token.length > 0 && schluesselGleich(token, geheim);
}

export async function anfrageAnlegen(
  nutzerId: string,
  a: {
    quelle: AnfrageQuelle;
    name: string;
    email: string;
    telefon: string | null;
    unternehmen: string | null;
    antworten: PlaybookAntwort[];
    seite: string | null;
    dublette: boolean;
  },
) {
  const email = emailNorm(a.email);
  const kontaktId = await kontaktAusPlaybook(nutzerId, a.name, email, a.telefon, a.unternehmen, 'anfrage');
  const id = neueId();
  const jetzt = jetztIso();
  await ausfuehren(
    `INSERT INTO anfragen (id, nutzer_id, kontakt_id, quelle, name, email, telefon, unternehmen, antworten, seite, dublette, erstellt_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, nutzerId, kontaktId, a.quelle, a.name, email, a.telefon, a.unternehmen,
    a.antworten.length ? JSON.stringify(a.antworten) : null, a.seite, a.dublette ? 1 : 0, jetzt,
  );
  // WhatsApp Lead mit derselben Anfragenummer kam schon vorher an: gleich verknüpfen (sonst in leadAnlegen)
  const nummer = a.antworten.find((x) => x.frage === 'Anfragenummer')?.antwort?.trim().toUpperCase();
  if (nummer) {
    const g = await eins<{ id: string; erstellt_am: string }>(
      "SELECT id, erstellt_am FROM wa_gespraeche WHERE referenz = ? AND anfrage_id IS NULL AND zuordnung = 'formular' ORDER BY erstellt_am DESC LIMIT 1",
      nummer,
    ).catch(() => null);
    if (g) {
      await ausfuehren('UPDATE wa_gespraeche SET anfrage_id = ? WHERE id = ?', id, g.id);
      await ausfuehren('UPDATE anfragen SET whatsapp_gespraech_id = ?, whatsapp_am = ? WHERE id = ?', g.id, g.erstellt_am, id);
    }
  }
  return { id, kontaktId, erstelltAm: jetzt };
}

/** Gespeicherte Antworten lesen, defekte Daten ergeben eine leere Liste */
export function anfrageAntworten(a: Pick<Anfrage, 'antworten'>): PlaybookAntwort[] {
  if (!a.antworten) return [];
  try {
    return antwortenPruefen(JSON.parse(a.antworten));
  } catch {
    return [];
  }
}

export type AnfrageZeile = Anfrage & { kontakt_name: string | null; kontakt_telefon: string | null; kontakt_unternehmen: string | null };

/** Liste im Backoffice (/app/anfragen) und CSV Export, neueste zuerst */
export function anfrageAbfrage(nutzerId: string, o: { quelle?: AnfrageQuelle | null; suche?: string }) {
  const werte: (string | number)[] = [nutzerId];
  const bedingungen = ['a.nutzer_id = ?1'];
  if (o.quelle) {
    werte.push(o.quelle);
    bedingungen.push(`a.quelle = ?${werte.length}`);
  }
  if (o.suche) {
    werte.push(`%${o.suche.toLowerCase().replace(/[%_\\]/g, (z) => `\\${z}`)}%`);
    const p = `?${werte.length}`;
    bedingungen.push(`(lower(COALESCE(k.name, a.name)) LIKE ${p} ESCAPE '\\' OR a.email LIKE ${p} ESCAPE '\\' OR lower(COALESCE(k.unternehmen, a.unternehmen, '')) LIKE ${p} ESCAPE '\\')`);
  }
  const basis = `FROM anfragen a LEFT JOIN kontakte k ON k.id = a.kontakt_id WHERE ${bedingungen.join(' AND ')}`;
  return {
    liste: (limit: number, offset: number) =>
      alle<AnfrageZeile>(
        `SELECT a.*, k.name AS kontakt_name, k.telefon AS kontakt_telefon, k.unternehmen AS kontakt_unternehmen ${basis}
         ORDER BY a.erstellt_am DESC LIMIT ${limit} OFFSET ${offset}`,
        ...werte,
      ),
    anzahl: async () => (await eins<{ n: number }>(`SELECT COUNT(*) AS n ${basis}`, ...werte))?.n ?? 0,
  };
}

/** Anzahl je Quelle, für die Reiter über der Liste */
export async function anfragenJeQuelle(nutzerId: string) {
  const zeilen = await alle<{ quelle: string; n: number }>('SELECT quelle, COUNT(*) AS n FROM anfragen WHERE nutzer_id = ? GROUP BY quelle', nutzerId);
  return new Map(zeilen.map((z) => [z.quelle, z.n]));
}

export async function anfragenVonKontakt(kontaktId: string) {
  return alle<Anfrage>('SELECT * FROM anfragen WHERE kontakt_id = ? ORDER BY erstellt_am DESC LIMIT 50', kontaktId);
}

/** Cron: Anfragen nach der Aufbewahrungsfrist löschen */
export async function anfragenAufraeumen() {
  const grenze = new Date(Date.now() - AUFBEWAHRUNG_TAGE * 86_400_000).toISOString();
  const r = await ausfuehren('DELETE FROM anfragen WHERE erstellt_am < ?', grenze);
  return r.meta?.changes ?? 0;
}
