/**
 * Persönliche Links zu den vier Playbooks.
 *
 * Ablauf: Eine Playbook Landingpage (eigene Repos playbook_website, playbook_social_media,
 * playbook_social_recruiting, playbook_gastro) ruft nach dem Formular serverseitig
 * POST /api/playbook/anfordern auf (Bearer PLAYBOOK_SCHLUESSEL). Let's Meet legt den Kontakt
 * an, erzeugt einen Zugang mit zufälliger ID (das Geheimnis im Link) und gibt den Link zurück,
 * die Landingpage schickt ihn per Mail. Der Link gilt 14 Tage. Öffnen der Seite und
 * Herunterladen der PDF werden am Zugang gezählt und im Kontaktbuch angezeigt.
 *
 * Die Dateien liegen in public/playbook-dateien/{schluessel}/ (playbook.pdf, seite-001.webp ...),
 * direkte Aufrufe dorthin blockt src/worker.ts. Ausgeliefert wird nur über /playbook/{id}/...
 * nach Prüfung des Zugangs. Welche Dateien es gibt, steht in src/daten/playbook-dateien.json
 * (erzeugt von scripts/playbook-vorbereiten.mjs).
 */
import { env } from 'cloudflare:workers';
import dateien from '../daten/playbook-dateien.json';
import { alle, ausfuehren, eins, jetztIso, neueId } from './db';
import { emailNorm, kontaktAusPlaybook } from './kontakte';

export const PLAYBOOK_GUELTIG_TAGE = 14;
/** Zugänge fallen so lange nach ihrem Ablauf weg (Datenschutz, 12 Monate wie Buchungen) */
const AUFBEWAHRUNG_TAGE = 365;

export const PLAYBOOKS = {
  website: {
    name: 'Website Conversion Playbook',
    landingpage: 'https://website-conversion-playbook.thatsit.marketing/',
    gespraech: 'strategiegespraech-webseite',
    gespraechName: 'Strategiegespräch Webseite',
  },
  social: {
    name: 'Social Media Playbook',
    landingpage: 'https://social-media-playbook.thatsit.marketing/',
    gespraech: 'strategiegespraech-social-media',
    gespraechName: 'Strategiegespräch Social Media',
  },
  recruiting: {
    name: 'Social Recruiting Playbook',
    landingpage: 'https://social-recruiting-playbook.thatsit.marketing/',
    gespraech: 'strategiegespraech-recruiting',
    gespraechName: 'Strategiegespräch Social Recruiting',
  },
  gastro: {
    name: 'Gastro Marketing Playbook',
    landingpage: 'https://gastro-marketing-playbook.thatsit.marketing/',
    gespraech: 'strategiegespraech-social-media',
    gespraechName: 'Strategiegespräch Social Media',
  },
} as const;

export type PlaybookSchluessel = keyof typeof PLAYBOOKS;

export const istPlaybook = (wert: unknown): wert is PlaybookSchluessel =>
  typeof wert === 'string' && Object.hasOwn(PLAYBOOKS, wert);

export interface PlaybookDateien {
  /** Anzahl der Seitenbilder seite-001.webp ... */
  seiten: number;
  /** Seitenverhältnis der Seitenbilder in Pixeln */
  breite: number;
  hoehe: number;
  /** Größe der PDF in Byte, 0 wenn keine PDF hinterlegt ist */
  pdfBytes: number;
  /** Stand der Dateien, ISO Datum */
  stand: string;
}

/** Was für ein Playbook hinterlegt ist. Fehlt der Eintrag, gibt es noch keine Dateien. */
export function playbookDateien(schluessel: PlaybookSchluessel): PlaybookDateien | null {
  const eintrag = (dateien as Record<string, PlaybookDateien | undefined>)[schluessel];
  return eintrag && (eintrag.seiten > 0 || eintrag.pdfBytes > 0) ? eintrag : null;
}

/** Pfad im Assets Speicher, nie direkt erreichbar (siehe src/worker.ts) */
export const dateiPfad = (schluessel: PlaybookSchluessel, datei: string) => `/playbook-dateien/${schluessel}/${datei}`;
export const seitenDatei = (nr: number) => `seite-${String(nr).padStart(3, '0')}.webp`;

export interface PlaybookZugang {
  id: string;
  nutzer_id: string;
  kontakt_id: string | null;
  playbook: string;
  name: string;
  email: string;
  telefon: string | null;
  unternehmen: string | null;
  erstellt_am: string;
  gueltig_bis: string;
  erstmals_geoeffnet: string | null;
  zuletzt_geoeffnet: string | null;
  aufrufe: number;
  erstmals_geladen: string | null;
  zuletzt_geladen: string | null;
  downloads: number;
  gesperrt: number;
  link_versendet: number;
}

export type ZugangStatus = 'gueltig' | 'abgelaufen' | 'gesperrt';

export function zugangStatus(z: Pick<PlaybookZugang, 'gueltig_bis' | 'gesperrt'>, jetzt = Date.now()): ZugangStatus {
  if (z.gesperrt) return 'gesperrt';
  return Date.parse(z.gueltig_bis) > jetzt ? 'gueltig' : 'abgelaufen';
}

/** Vergleich in konstanter Zeit, damit die Antwortzeit nichts über den Schlüssel verrät */
export function schluesselGleich(a: string, b: string) {
  const ka = new TextEncoder().encode(a);
  const kb = new TextEncoder().encode(b);
  let unterschied = ka.length ^ kb.length;
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) unterschied |= (ka[i] ?? 0) ^ (kb[i] ?? 0);
  return unterschied === 0;
}

/** Prüft den Bearer Schlüssel der Landingpages. Ohne gesetzten Schlüssel ist die Schnittstelle zu. */
export function anfrageBerechtigt(request: Request) {
  const geheim = env.PLAYBOOK_SCHLUESSEL?.trim();
  if (!geheim || geheim.length < 24) return false;
  const kopf = request.headers.get('authorization') ?? '';
  const token = kopf.startsWith('Bearer ') ? kopf.slice(7).trim() : '';
  return token.length > 0 && schluesselGleich(token, geheim);
}

export interface PlaybookAnfrage {
  playbook: PlaybookSchluessel;
  name: string;
  email: string;
  telefon: string | null;
  unternehmen: string | null;
}

/**
 * Legt Kontakt und Zugang an. Jede Anfrage bekommt einen eigenen Link und steht in der Leadliste.
 * linkVersendet = false, solange für das Playbook keine Dateien hinterlegt sind (die Mail nimmt dann
 * den alten Downloadlink der Landingpage).
 */
export async function zugangAnlegen(nutzerId: string, a: PlaybookAnfrage, linkVersendet = true) {
  const email = emailNorm(a.email);
  const kontaktId = await kontaktAusPlaybook(nutzerId, a.name, email, a.telefon, a.unternehmen);
  // 24 Byte Zufall, rund 38 Zeichen: nicht zu erraten, auch nicht durch Ausprobieren
  const id = neueId(24);
  const jetzt = new Date();
  const gueltigBis = new Date(jetzt.getTime() + PLAYBOOK_GUELTIG_TAGE * 86_400_000).toISOString();
  await ausfuehren(
    `INSERT INTO playbook_zugaenge (id, nutzer_id, kontakt_id, playbook, name, email, telefon, unternehmen, erstellt_am, gueltig_bis, link_versendet)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, nutzerId, kontaktId, a.playbook, a.name, email, a.telefon, a.unternehmen, jetzt.toISOString(), gueltigBis, linkVersendet ? 1 : 0,
  );
  return { id, gueltigBis, kontaktId };
}

/** IDs bestehen nur aus Kleinbuchstaben und Ziffern, alles andere ist sofort ungültig */
export const zugangIdGueltig = (id: string) => /^[a-z0-9]{20,64}$/.test(id);

export async function zugangLesen(id: string) {
  if (!zugangIdGueltig(id)) return null;
  return eins<PlaybookZugang>('SELECT * FROM playbook_zugaenge WHERE id = ?', id);
}

/** Seite wurde angesehen (vom Browser gemeldet, damit Linkprüfungen der Mailprogramme nicht zählen) */
export async function aufrufMerken(id: string) {
  const jetzt = jetztIso();
  await ausfuehren(
    `UPDATE playbook_zugaenge SET aufrufe = aufrufe + 1, zuletzt_geoeffnet = ?, erstmals_geoeffnet = COALESCE(erstmals_geoeffnet, ?) WHERE id = ?`,
    jetzt, jetzt, id,
  );
}

export async function downloadMerken(id: string) {
  const jetzt = jetztIso();
  await ausfuehren(
    `UPDATE playbook_zugaenge SET downloads = downloads + 1, zuletzt_geladen = ?, erstmals_geladen = COALESCE(erstmals_geladen, ?) WHERE id = ?`,
    jetzt, jetzt, id,
  );
}

export async function zugaengeVonKontakt(kontaktId: string) {
  return alle<PlaybookZugang>('SELECT * FROM playbook_zugaenge WHERE kontakt_id = ? ORDER BY erstellt_am DESC LIMIT 50', kontaktId);
}

export type PlaybookStand = 'geladen' | 'geoeffnet' | 'angefordert';

/** Weitester Stand je Kontakt für die Markierung in der Kontaktliste */
export async function playbookStandVonKontakten(kontaktIds: string[]) {
  const stand = new Map<string, PlaybookStand>();
  if (kontaktIds.length === 0) return stand;
  const platz = kontaktIds.map(() => '?').join(', ');
  const zeilen = await alle<{ kontakt_id: string; geladen: number; geoeffnet: number }>(
    `SELECT kontakt_id, MAX(downloads > 0) AS geladen, MAX(aufrufe > 0) AS geoeffnet
     FROM playbook_zugaenge WHERE kontakt_id IN (${platz}) GROUP BY kontakt_id`,
    ...kontaktIds,
  );
  for (const z of zeilen) stand.set(z.kontakt_id, z.geladen ? 'geladen' : z.geoeffnet ? 'geoeffnet' : 'angefordert');
  return stand;
}

/* Leadliste im Backoffice (/app/playbook-leads) */

export const LEAD_STAND = ['alle', 'angefordert', 'geoeffnet', 'geladen'] as const;
export type LeadStand = (typeof LEAD_STAND)[number];

/** Eine Zeile je Anfrage, neueste zuerst. Kontaktdaten kommen aus dem Kontaktbuch, falls dort gepflegt. */
export function leadAbfrage(nutzerId: string, o: { playbook?: PlaybookSchluessel | null; stand?: LeadStand; suche?: string }) {
  const werte: (string | number)[] = [nutzerId];
  const bedingungen = ['z.nutzer_id = ?1'];
  if (o.playbook) {
    werte.push(o.playbook);
    bedingungen.push(`z.playbook = ?${werte.length}`);
  }
  if (o.stand === 'angefordert') bedingungen.push('z.aufrufe = 0 AND z.downloads = 0');
  if (o.stand === 'geoeffnet') bedingungen.push('z.aufrufe > 0 AND z.downloads = 0');
  if (o.stand === 'geladen') bedingungen.push('z.downloads > 0');
  if (o.suche) {
    werte.push(`%${o.suche.toLowerCase().replace(/[%_\\]/g, (z) => `\\${z}`)}%`);
    const p = `?${werte.length}`;
    bedingungen.push(`(lower(COALESCE(k.name, z.name)) LIKE ${p} ESCAPE '\\' OR z.email LIKE ${p} ESCAPE '\\' OR lower(COALESCE(k.unternehmen, z.unternehmen, '')) LIKE ${p} ESCAPE '\\')`);
  }
  const basis = `FROM playbook_zugaenge z LEFT JOIN kontakte k ON k.id = z.kontakt_id WHERE ${bedingungen.join(' AND ')}`;
  return {
    liste: (limit: number, offset: number) =>
      alle<PlaybookZugang & { kontakt_name: string | null; kontakt_telefon: string | null; kontakt_unternehmen: string | null }>(
        `SELECT z.*, k.name AS kontakt_name, k.telefon AS kontakt_telefon, k.unternehmen AS kontakt_unternehmen ${basis}
         ORDER BY z.erstellt_am DESC LIMIT ${limit} OFFSET ${offset}`,
        ...werte,
      ),
    anzahl: async () => (await eins<{ n: number }>(`SELECT COUNT(*) AS n ${basis}`, ...werte))?.n ?? 0,
  };
}

/** Anzahl der Anfragen je Playbook, für die Reiter über der Liste */
export async function leadsJePlaybook(nutzerId: string) {
  const zeilen = await alle<{ playbook: string; n: number }>('SELECT playbook, COUNT(*) AS n FROM playbook_zugaenge WHERE nutzer_id = ? GROUP BY playbook', nutzerId);
  return new Map(zeilen.map((z) => [z.playbook, z.n]));
}

/** Link sperren oder um PLAYBOOK_GUELTIG_TAGE ab heute verlängern (Backoffice) */
export async function zugangSperren(nutzerId: string, id: string) {
  await ausfuehren('UPDATE playbook_zugaenge SET gesperrt = 1 WHERE id = ? AND nutzer_id = ?', id, nutzerId);
}
export async function zugangVerlaengern(nutzerId: string, id: string) {
  const bis = new Date(Date.now() + PLAYBOOK_GUELTIG_TAGE * 86_400_000).toISOString();
  await ausfuehren('UPDATE playbook_zugaenge SET gesperrt = 0, gueltig_bis = ? WHERE id = ? AND nutzer_id = ?', bis, id, nutzerId);
}

/** Cron: abgelaufene Zugänge nach der Aufbewahrungsfrist löschen */
export async function playbookZugaengeAufraeumen() {
  const grenze = new Date(Date.now() - AUFBEWAHRUNG_TAGE * 86_400_000).toISOString();
  const r = await ausfuehren('DELETE FROM playbook_zugaenge WHERE gueltig_bis < ?', grenze);
  return r.meta?.changes ?? 0;
}

/** Link zum passenden Gespräch, Angaben im Fragment vorausgefüllt (wie aus den Playbook Mails) */
export function gespraechLink(z: PlaybookZugang, basis = '') {
  const pb = istPlaybook(z.playbook) ? PLAYBOOKS[z.playbook] : PLAYBOOKS.website;
  const p = new URLSearchParams();
  p.set('name', z.name);
  p.set('email', z.email);
  if (z.telefon) p.set('telefon', z.telefon);
  p.set('nachricht', [z.unternehmen && `Unternehmen: ${z.unternehmen}`, `Playbook angefordert: ${pb.name}`].filter(Boolean).join('\n'));
  p.set('quelle', `playbook ${z.playbook}`);
  return `${basis}/${pb.gespraech}#${p.toString()}`;
}
