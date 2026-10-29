/**
 * Kontaktbuch des Büros. Kontakte entstehen aus Buchungen, aus Gästen im Google Kalender,
 * per CSV Import oder von Hand. Letztes und nächstes Meeting werden beim Lesen aus
 * buchungen und google_termine berechnet. kontakte.letztes_meeting hält zusätzlich den Stand
 * aus Google und Import fest, weil google_termine nach 30 Tagen aufgeräumt wird.
 */
import { alle, ausfuehren, db, eins, jetztIso, neueId } from './db';
import { emailGueltig, telefonGueltig, trimmen } from './eingabe';
import type { GoogleTermin } from './google';
import type { Kontakt, Nutzer } from './typen';

export const emailNorm = (email: string) => email.trim().toLowerCase();

/** Name aus der Adresse, falls Google keinen liefert: max.mustermann@firma.de wird Max Mustermann */
export function nameAusEmail(email: string) {
  const teil = email.split('@')[0] ?? email;
  const worte = teil.split(/[._-]+/).filter((w) => w && !/^\d+$/.test(w));
  if (worte.length === 0) return email;
  return worte.map((w) => w.replace(/\d+$/, '')).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ') || email;
}

/** Nach einer Buchung: Kontakt anlegen oder Telefon ergänzen. Ein entfernter Kontakt kommt damit zurück. */
export async function kontaktAusBuchung(nutzerId: string, name: string, email: string, telefon: string | null) {
  const jetzt = jetztIso();
  await ausfuehren(
    `INSERT INTO kontakte (id, nutzer_id, name, email, telefon, quelle, erstellt_am, aktualisiert_am)
     VALUES (?, ?, ?, ?, ?, 'buchung', ?, ?)
     ON CONFLICT (nutzer_id, email) WHERE email IS NOT NULL DO UPDATE SET
       name = CASE WHEN kontakte.quelle = 'google' OR kontakte.ausgeblendet = 1 THEN excluded.name ELSE kontakte.name END,
       quelle = CASE WHEN kontakte.quelle = 'google' THEN 'buchung' ELSE kontakte.quelle END,
       telefon = COALESCE(excluded.telefon, kontakte.telefon),
       ausgeblendet = 0,
       aktualisiert_am = excluded.aktualisiert_am`,
    neueId(), nutzerId, name, emailNorm(email), telefon, jetzt, jetzt,
  );
}

/**
 * Nach dem Google Abgleich: Gäste als Kontakte anlegen und das letzte Meeting festhalten.
 * Teammitglieder und der Kalender selbst zählen nicht, entfernte Kontakte bleiben entfernt.
 */
export async function kontakteAusGoogle(nutzer: Nutzer, termine: GoogleTermin[]) {
  const team = new Set(
    (await alle<{ email: string }>('SELECT lower(email) AS email FROM nutzer')).map((t) => t.email),
  );
  if (nutzer.google_email) team.add(emailNorm(nutzer.google_email));
  const jetzt = Date.now();
  const gaeste = new Map<string, { name: string; letztes: string | null }>();
  for (const t of termine) {
    for (const g of t.gaeste) {
      if (team.has(g.email) || !emailGueltig(g.email)) continue;
      const vorher = gaeste.get(g.email);
      const start = t.start < jetzt ? new Date(t.start).toISOString() : null;
      gaeste.set(g.email, {
        name: vorher?.name || g.name || '',
        letztes: [vorher?.letztes ?? null, start].filter(Boolean).sort().pop() ?? null,
      });
    }
  }
  if (gaeste.size === 0) return 0;
  const stand = jetztIso();
  const d = db();
  const befehle = [...gaeste.entries()].map(([email, g]) =>
    d.prepare(
      `INSERT INTO kontakte (id, nutzer_id, name, email, quelle, letztes_meeting, erstellt_am, aktualisiert_am)
       VALUES (?, ?, ?, ?, 'google', ?, ?, ?)
       ON CONFLICT (nutzer_id, email) WHERE email IS NOT NULL DO UPDATE SET
         letztes_meeting = NULLIF(MAX(COALESCE(kontakte.letztes_meeting, ''), COALESCE(excluded.letztes_meeting, '')), '')`,
    ).bind(neueId(), nutzer.id, (g.name || nameAusEmail(email)).slice(0, 120), email, g.letztes, stand, stand),
  );
  for (let i = 0; i < befehle.length; i += 50) await d.batch(befehle.slice(i, i + 50));
  return gaeste.size;
}

export type KontaktZeile = Kontakt & { letztes: string | null; naechstes: string | null };

export const KONTAKT_FILTER = ['alle', 'anstehend', 'neu', 'ohne'] as const;
export type KontaktFilter = (typeof KONTAKT_FILTER)[number];
export const KONTAKT_SORTIERUNG = ['letztes', 'naechstes', 'name', 'neu'] as const;
export type KontaktSortierung = (typeof KONTAKT_SORTIERUNG)[number];

/**
 * Basisabfrage mit berechnetem letzten und nächsten Meeting.
 * Platzhalter: ?1 jetzt, ?2 nutzer_id. Nicht erschienene und abgesagte Buchungen zählen nicht.
 */
const KONTAKTE_MIT_MEETINGS = `
  WITH b AS (
    SELECT lower(gast_email) AS email,
      MAX(CASE WHEN start_utc < ?1 AND nicht_erschienen = 0 THEN start_utc END) AS letztes,
      MIN(CASE WHEN start_utc >= ?1 THEN start_utc END) AS naechstes
    FROM buchungen WHERE nutzer_id = ?2 AND status = 'bestaetigt' GROUP BY lower(gast_email)
  ), g AS (
    SELECT j.value AS email,
      MAX(CASE WHEN gt.start_utc < ?1 THEN gt.start_utc END) AS letztes,
      MIN(CASE WHEN gt.start_utc >= ?1 THEN gt.start_utc END) AS naechstes
    FROM google_termine gt, json_each(gt.gaeste) j
    WHERE gt.nutzer_id = ?2 AND gt.gaeste IS NOT NULL GROUP BY j.value
  ), k AS (
    SELECT kontakte.*,
      NULLIF(MAX(COALESCE(kontakte.letztes_meeting, ''), COALESCE(b.letztes, ''), COALESCE(g.letztes, '')), '') AS letztes,
      NULLIF(MIN(COALESCE(b.naechstes, '~'), COALESCE(g.naechstes, '~')), '~') AS naechstes
    FROM kontakte
    LEFT JOIN b ON b.email = kontakte.email
    LEFT JOIN g ON g.email = kontakte.email
    WHERE kontakte.nutzer_id = ?2 AND kontakte.ausgeblendet = 0
  )`;

export function kontaktAbfrage(nutzerId: string, o: { suche?: string; filter?: KontaktFilter; sortierung?: KontaktSortierung }) {
  const jetzt = new Date();
  const werte: (string | number)[] = [jetzt.toISOString(), nutzerId];
  const bedingungen: string[] = [];
  if (o.suche) {
    werte.push(`%${o.suche.toLowerCase().replace(/[%_\\]/g, (z) => `\\${z}`)}%`);
    const p = `?${werte.length}`;
    bedingungen.push(
      `(lower(name) LIKE ${p} ESCAPE '\\' OR email LIKE ${p} ESCAPE '\\' OR lower(COALESCE(telefon, '')) LIKE ${p} ESCAPE '\\' OR lower(COALESCE(unternehmen, '')) LIKE ${p} ESCAPE '\\')`,
    );
  }
  if (o.filter === 'anstehend') bedingungen.push('naechstes IS NOT NULL');
  if (o.filter === 'neu') {
    werte.push(new Date(jetzt.getTime() - 30 * 86_400_000).toISOString());
    bedingungen.push(`erstellt_am >= ?${werte.length}`);
  }
  if (o.filter === 'ohne') {
    werte.push(new Date(jetzt.getTime() + 30 * 86_400_000).toISOString());
    bedingungen.push(`(naechstes IS NULL OR naechstes > ?${werte.length})`);
  }
  const where = bedingungen.length ? `WHERE ${bedingungen.join(' AND ')}` : '';
  const ordnung: Record<KontaktSortierung, string> = {
    letztes: 'letztes IS NULL, letztes DESC, name COLLATE NOCASE',
    naechstes: 'naechstes IS NULL, naechstes ASC, letztes DESC, name COLLATE NOCASE',
    name: 'name COLLATE NOCASE, email',
    neu: 'erstellt_am DESC, name COLLATE NOCASE',
  };
  return {
    liste: (limit: number, offset: number) =>
      alle<KontaktZeile>(
        `${KONTAKTE_MIT_MEETINGS} SELECT * FROM k ${where} ORDER BY ${ordnung[o.sortierung ?? 'letztes']} LIMIT ${limit} OFFSET ${offset}`,
        ...werte,
      ),
    anzahl: async () => (await eins<{ n: number }>(`${KONTAKTE_MIT_MEETINGS} SELECT COUNT(*) AS n FROM k ${where}`, ...werte))?.n ?? 0,
  };
}

export async function kontaktMitMeetings(nutzerId: string, id: string) {
  return eins<KontaktZeile>(`${KONTAKTE_MIT_MEETINGS} SELECT * FROM k WHERE id = ?3`, new Date().toISOString(), nutzerId, id);
}

export type KontaktMeeting =
  | { art: 'buchung'; id: string; titel: string; farbe: string; start: string; ende: string; status: string; nichtErschienen: boolean }
  | { art: 'google'; id: string; titel: string; start: string; ende: string };

/** Alle bekannten Meetings eines Kontakts, neueste zuerst. Google Kopien eigener Buchungen erscheinen nicht doppelt. */
export async function meetingsVon(nutzerId: string, email: string | null): Promise<KontaktMeeting[]> {
  if (!email) return [];
  const [buchungen, google] = await Promise.all([
    alle<{ id: string; titel: string; farbe: string; start_utc: string; ende_utc: string; status: string; nicht_erschienen: number; storno_grund: string | null }>(
      `SELECT b.id, t.titel, t.farbe, b.start_utc, b.ende_utc, b.status, b.nicht_erschienen, b.storno_grund FROM buchungen b
       JOIN terminarten t ON t.id = b.terminart_id
       WHERE b.nutzer_id = ? AND lower(b.gast_email) = ? ORDER BY b.start_utc DESC LIMIT 100`,
      nutzerId, email,
    ),
    alle<{ event_id: string; titel: string; start_utc: string; ende_utc: string }>(
      `SELECT gt.event_id, gt.titel, gt.start_utc, gt.ende_utc FROM google_termine gt
       WHERE gt.nutzer_id = ? AND gt.gaeste IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(gt.gaeste) j WHERE j.value = ?)
         AND NOT EXISTS (SELECT 1 FROM buchungen b WHERE b.nutzer_id = gt.nutzer_id AND b.google_event_id = gt.event_id)
       ORDER BY gt.start_utc DESC LIMIT 100`,
      nutzerId, email,
    ),
  ]);
  return [
    ...buchungen.map((b) => ({
      art: 'buchung' as const, id: b.id, titel: b.titel, farbe: b.farbe, start: b.start_utc, ende: b.ende_utc,
      status: b.status === 'storniert' ? (b.storno_grund === 'Umgebucht' ? 'Umgebucht' : 'Abgesagt') : 'Bestätigt',
      nichtErschienen: Boolean(b.nicht_erschienen),
    })),
    ...google.map((g) => ({ art: 'google' as const, id: g.event_id, titel: g.titel, start: g.start_utc, ende: g.ende_utc })),
  ].sort((a, b) => b.start.localeCompare(a.start));
}

export interface KontaktWerte {
  name: string;
  email: string;
  telefon: string;
  unternehmen: string;
  notiz: string;
}

export function kontaktAusFormular(form: FormData) {
  const werte: KontaktWerte = {
    name: trimmen(form.get('name'), 120),
    email: emailNorm(trimmen(form.get('email'), 180)),
    telefon: trimmen(form.get('telefon'), 40),
    unternehmen: trimmen(form.get('unternehmen'), 160),
    notiz: trimmen(form.get('notiz'), 5000),
  };
  const fehler: Record<string, string> = {};
  if (werte.name.length < 2) fehler.name = 'Bitte gib einen Namen an.';
  if (werte.email && !emailGueltig(werte.email)) fehler.email = 'Diese E Mail Adresse sieht nicht gültig aus.';
  if (werte.telefon && !telefonGueltig(werte.telefon)) fehler.telefon = 'Bitte nur Ziffern, Leerzeichen und + ( ) / - verwenden.';
  return { werte, fehler };
}

/**
 * Speichert einen Kontakt aus dem Backoffice. Gibt die ID zurück oder einen Fehler,
 * wenn die E Mail schon zu einem anderen sichtbaren Kontakt gehört.
 */
export async function kontaktSpeichern(nutzerId: string, w: KontaktWerte, id?: string): Promise<{ id: string } | { doppelt: string }> {
  const jetzt = jetztIso();
  if (w.email) {
    const vorhanden = await eins<{ id: string; ausgeblendet: number }>('SELECT id, ausgeblendet FROM kontakte WHERE nutzer_id = ? AND email = ?', nutzerId, w.email);
    if (vorhanden && vorhanden.id !== id) {
      if (!vorhanden.ausgeblendet) return { doppelt: vorhanden.id };
      // Früher entfernter Kontakt mit derselben Adresse: diesen wieder aufnehmen
      if (id) await ausfuehren('DELETE FROM kontakte WHERE id = ? AND nutzer_id = ?', id, nutzerId);
      id = vorhanden.id;
    }
  }
  if (id) {
    await ausfuehren(
      `UPDATE kontakte SET name = ?, email = ?, telefon = ?, unternehmen = ?, notiz = ?, ausgeblendet = 0, aktualisiert_am = ? WHERE id = ? AND nutzer_id = ?`,
      w.name, w.email || null, w.telefon || null, w.unternehmen || null, w.notiz || null, jetzt, id, nutzerId,
    );
    return { id };
  }
  const neu = neueId();
  await ausfuehren(
    `INSERT INTO kontakte (id, nutzer_id, name, email, telefon, unternehmen, notiz, quelle, erstellt_am, aktualisiert_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'manuell', ?, ?)`,
    neu, nutzerId, w.name, w.email || null, w.telefon || null, w.unternehmen || null, w.notiz || null, jetzt, jetzt,
  );
  return { id: neu };
}

/**
 * Entfernt einen Kontakt. Mit E Mail bleibt nur Name und Adresse als ausgeblendeter Eintrag,
 * damit der Google Abgleich ihn nicht wieder anlegt. Eine neue Buchung holt ihn zurück.
 */
export async function kontaktEntfernen(nutzerId: string, id: string) {
  const k = await eins<Kontakt>('SELECT * FROM kontakte WHERE id = ? AND nutzer_id = ?', id, nutzerId);
  if (!k) return;
  if (!k.email) {
    await ausfuehren('DELETE FROM kontakte WHERE id = ?', id);
    return;
  }
  await ausfuehren(
    `UPDATE kontakte SET ausgeblendet = 1, telefon = NULL, unternehmen = NULL, notiz = NULL, letztes_meeting = NULL, aktualisiert_am = ? WHERE id = ?`,
    jetztIso(), id,
  );
}

/* CSV Import, etwa aus dem Kontaktexport von Calendly oder einer Tabelle */

/** Liest CSV mit Komma, Semikolon oder Tab als Trenner, Anführungszeichen wie in Excel. */
export function csvLesen(text: string): string[][] {
  const roh = text.replace(/^﻿/, '');
  const ersteZeile = roh.split(/\r?\n/, 1)[0] ?? '';
  const zaehle = (z: string) => ersteZeile.split(z).length;
  const trenner = [';', '\t', ','].sort((a, b) => zaehle(b) - zaehle(a))[0]!;
  const zeilen: string[][] = [];
  let zeile: string[] = [];
  let feld = '';
  let inZitat = false;
  for (let i = 0; i < roh.length; i++) {
    const z = roh[i]!;
    if (inZitat) {
      if (z === '"' && roh[i + 1] === '"') { feld += '"'; i++; }
      else if (z === '"') inZitat = false;
      else feld += z;
    } else if (z === '"') inZitat = true;
    else if (z === trenner) { zeile.push(feld); feld = ''; }
    else if (z === '\n' || z === '\r') {
      if (z === '\r' && roh[i + 1] === '\n') i++;
      zeile.push(feld); feld = '';
      if (zeile.some((f) => f.trim())) zeilen.push(zeile);
      zeile = [];
    } else feld += z;
  }
  zeile.push(feld);
  if (zeile.some((f) => f.trim())) zeilen.push(zeile);
  return zeilen;
}

const MONATE: Record<string, number> = {
  jan: 1, feb: 2, 'mär': 3, mrz: 3, mar: 3, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12,
};

/** Datum aus „9. Okt. 2026“, „09.10.2026“, „2026-10-09“ oder „Oct 9, 2026“, als ISO in UTC (12 Uhr) */
export function datumLesen(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  let j: number | undefined, m: number | undefined, d: number | undefined;
  let r = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (r) [j, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/))) [d, m, j] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = t.match(/^(\d{1,2})\.?\s+([a-zäöü]+)\.?\s+(\d{4})/))) [d, m, j] = [Number(r[1]), MONATE[r[2]!.slice(0, 3)], Number(r[3])];
  else if ((r = t.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/))) [m, d, j] = [MONATE[r[1]!.slice(0, 3)], Number(r[2]), Number(r[3])];
  if (!j || !m || !d) return null;
  if (j < 100) j += 2000;
  const datum = new Date(Date.UTC(j, m - 1, d, 12));
  return Number.isNaN(datum.getTime()) || datum.getUTCDate() !== d ? null : datum.toISOString();
}

const SPALTEN: Record<keyof KontaktWerte | 'vorname' | 'nachname' | 'letztes', string[]> = {
  name: ['name', 'vollständiger name', 'full name', 'kontakt', 'invitee name'],
  vorname: ['vorname', 'first name'],
  nachname: ['nachname', 'last name'],
  email: ['email', 'e-mail', 'e mail', 'e-mail-adresse', 'e mail adresse', 'email address', 'invitee email', 'mail'],
  telefon: ['telefon', 'telefonnummer', 'phone', 'phone number', 'mobil', 'handy', 'mobile'],
  unternehmen: ['unternehmen', 'firma', 'company', 'organisation'],
  notiz: ['notiz', 'notizen', 'notes', 'note', 'bemerkung'],
  letztes: ['datum des letzten meetings', 'letztes meeting', 'last meeting', 'last meeting date', 'letzter termin'],
};

/** Ordnet die Kopfzeile den Feldern zu. Ohne Name oder E Mail Spalte ist die Datei unbrauchbar. */
function spaltenZuordnen(kopf: string[]) {
  const norm = kopf.map((k) => k.trim().toLowerCase().replace(/[_]+/g, ' '));
  const index = (namen: string[]) => norm.findIndex((k) => namen.includes(k));
  return Object.fromEntries(Object.entries(SPALTEN).map(([feld, namen]) => [feld, index(namen)])) as Record<keyof typeof SPALTEN, number>;
}

/** Importiert Kontakte. Vorhandene Adressen werden ergänzt, nicht überschrieben. */
export async function kontakteImportieren(nutzerId: string, text: string) {
  const zeilen = csvLesen(text);
  if (zeilen.length < 2) return { fehler: 'Die Datei enthält keine Kontakte. Erwartet wird eine Kopfzeile und darunter eine Zeile pro Kontakt.' };
  const s = spaltenZuordnen(zeilen[0]!);
  if (s.name < 0 && s.vorname < 0 && s.email < 0) {
    return { fehler: 'Keine Spalte „Name“ oder „E Mail“ gefunden. Bitte die erste Zeile als Kopfzeile mit diesen Namen anlegen.' };
  }
  // Unser Export setzt vor + = - @ ein Hochkomma gegen Formeln in Excel, das fällt hier wieder weg
  const feld = (z: string[], i: number) => (i >= 0 ? (z[i] ?? '').trim().replace(/^'(?=[=+\-@])/, '') : '');
  const jetzt = jetztIso();
  const d = db();
  const befehle: D1PreparedStatement[] = [];
  let uebersprungen = 0;
  for (const z of zeilen.slice(1, 2001)) {
    const email = emailNorm(feld(z, s.email)).slice(0, 180);
    const name = (feld(z, s.name) || [feld(z, s.vorname), feld(z, s.nachname)].filter(Boolean).join(' ') || (email ? nameAusEmail(email) : '')).slice(0, 120);
    const telefonRoh = feld(z, s.telefon).slice(0, 40);
    const telefon = telefonRoh && telefonGueltig(telefonRoh) ? telefonRoh : null;
    if (name.length < 2 || (email && !emailGueltig(email))) {
      uebersprungen++;
      continue;
    }
    const unternehmen = feld(z, s.unternehmen).slice(0, 160) || null;
    const notiz = feld(z, s.notiz).slice(0, 5000) || null;
    const letztes = datumLesen(feld(z, s.letztes));
    if (email) {
      befehle.push(
        d.prepare(
          `INSERT INTO kontakte (id, nutzer_id, name, email, telefon, unternehmen, notiz, quelle, letztes_meeting, erstellt_am, aktualisiert_am)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?)
           ON CONFLICT (nutzer_id, email) WHERE email IS NOT NULL DO UPDATE SET
             name = CASE WHEN kontakte.ausgeblendet = 1 OR kontakte.quelle = 'google' THEN excluded.name ELSE kontakte.name END,
             telefon = COALESCE(kontakte.telefon, excluded.telefon),
             unternehmen = COALESCE(kontakte.unternehmen, excluded.unternehmen),
             notiz = COALESCE(kontakte.notiz, excluded.notiz),
             letztes_meeting = NULLIF(MAX(COALESCE(kontakte.letztes_meeting, ''), COALESCE(excluded.letztes_meeting, '')), ''),
             ausgeblendet = 0,
             aktualisiert_am = excluded.aktualisiert_am`,
        ).bind(neueId(), nutzerId, name, email, telefon, unternehmen, notiz, letztes, jetzt, jetzt),
      );
    } else {
      // Ohne E Mail nur anlegen, wenn es Name und Telefon noch nicht gibt
      befehle.push(
        d.prepare(
          `INSERT INTO kontakte (id, nutzer_id, name, telefon, unternehmen, notiz, quelle, letztes_meeting, erstellt_am, aktualisiert_am)
           SELECT ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM kontakte WHERE nutzer_id = ? AND email IS NULL AND lower(name) = lower(?) AND COALESCE(telefon, '') = COALESCE(?, ''))`,
        ).bind(neueId(), nutzerId, name, telefon, unternehmen, notiz, letztes, jetzt, jetzt, nutzerId, name, telefon),
      );
    }
  }
  for (let i = 0; i < befehle.length; i += 50) await d.batch(befehle.slice(i, i + 50));
  return { importiert: befehle.length, uebersprungen };
}
