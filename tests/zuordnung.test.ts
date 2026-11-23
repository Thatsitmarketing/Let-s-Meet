/**
 * Tests der Zuordnung selbst geschriebener WhatsApp Chats (src/lib/whatsapp/zuordnung.ts).
 * Läuft ohne Abhängigkeiten mit Node 24: `pnpm test` (node --test, eingebautes SQLite).
 * Die Tabelle `anfragen` entsteht aus den echten Migrationen 0013 und 0017, geprüft wird also
 * dieselbe SQL (samt json_each), die in der D1 läuft.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  anfrageZuordnen,
  anfragenummerAusText,
  angabenDerAnfrage,
  istEntwurfNachricht,
  telefonNorm,
  type Abfrage,
} from '../src/lib/whatsapp/zuordnung.ts';

const TEXT = (nr: string) => `Hallo, ich habe gerade meinen kostenlosen Website-Entwurf angefragt (Anfrage ${nr}). Gerne per WhatsApp weiter.`;
const JETZT = new Date('2026-11-23T10:00:00Z');

function datenbank() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE nutzer (id TEXT PRIMARY KEY); CREATE TABLE kontakte (id TEXT PRIMARY KEY);');
  db.exec('CREATE TABLE wa_gespraeche (id TEXT PRIMARY KEY);');
  db.exec(readFileSync(new URL('../migrations/0013_anfragen.sql', import.meta.url), 'utf8'));
  // 0017 ergänzt auch wa_gespraeche, hier reicht der Teil für anfragen
  const m17 = readFileSync(new URL('../migrations/0017_whatsapp_zuordnung.sql', import.meta.url), 'utf8');
  for (const anweisung of m17.replace(/--.*$/gm, '').split(';').map((a) => a.trim()).filter(Boolean)) {
    if (/\banfragen\b/.test(anweisung)) db.exec(anweisung);
  }
  db.exec("INSERT INTO nutzer (id) VALUES ('buero')");
  const abfrage: Abfrage = async <T,>(sql: string, ...werte: (string | number | null)[]) => db.prepare(sql).all(...werte) as T[];
  const anlegen = (id: string, telefon: string | null, nummer: string | null, tageAlt = 0, weitere: { frage: string; antwort: string }[] = []) => {
    const antworten = [...weitere, ...(nummer ? [{ frage: 'Anfragenummer', antwort: nummer }, { frage: 'Kontaktweg', antwort: 'Anruf' }] : [])];
    db.prepare(
      `INSERT INTO anfragen (id, nutzer_id, quelle, name, email, telefon, unternehmen, antworten, erstellt_am)
       VALUES (?, 'buero', 'website-entwurf', ?, ?, ?, 'Becker Bau', ?, ?)`,
    ).run(id, `Lisa ${id}`, `${id}@example.com`, telefon, JSON.stringify(antworten), new Date(JETZT.getTime() - tageAlt * 86_400_000).toISOString());
  };
  return { abfrage, anlegen };
}

test('Anfragenummer aus dem vorausgefüllten Text', () => {
  assert.equal(anfragenummerAusText(TEXT('K7M2QX')), 'K7M2QX');
  assert.equal(anfragenummerAusText('Anfrage: ABC234'), 'ABC234');
  assert.equal(anfragenummerAusText('Meine Anfragenummer ist HJK789'), null, 'nur direkt hinter dem Wort');
  assert.equal(anfragenummerAusText('Anfragenummer HJK789'), 'HJK789');
  assert.equal(anfragenummerAusText('(Anfrage Nr. PQR456)'), 'PQR456');
  assert.equal(anfragenummerAusText('Anfrage gestellt, bitte melden'), null, 'normales Wort ist keine Nummer');
  assert.equal(anfragenummerAusText('Anfrage ABCDEFG'), null, 'zu lang');
  assert.equal(anfragenummerAusText('Anfrage ABC1O0'), null, '1, O und 0 gehören nicht zum Alphabet');
  assert.equal(anfragenummerAusText('Hallo, wann habt ihr offen?'), null);
});

test('Telefonnummern werden wie die wa_id von Meta verglichen', () => {
  assert.equal(telefonNorm('+49 170 1234567'), '491701234567');
  assert.equal(telefonNorm('0049 170 1234567'), '491701234567');
  assert.equal(telefonNorm('0170 / 123 45 67'), '491701234567');
  assert.equal(telefonNorm('0170-1234567'), '491701234567');
  assert.equal(telefonNorm('+43 664 1234567'), '436641234567');
  assert.equal(telefonNorm(''), '');
});

test('Zuordnung über die Absendernummer (Chat von der Nummer aus dem Formular)', async () => {
  const { abfrage, anlegen } = datenbank();
  anlegen('a1', '0170 1234567', 'K7M2QX');
  anlegen('a2', '0171 9999999', 'ZZZ222');
  const z = await anfrageZuordnen(abfrage, '491701234567', TEXT('K7M2QX'), JETZT);
  assert.equal(z?.weg, 'nummer');
  assert.equal(z?.anfrage?.id, 'a1');
  // Auch ohne Nummer im Text, die Absendernummer reicht
  const ohneText = await anfrageZuordnen(abfrage, '491701234567', 'Hallo!', JETZT);
  assert.equal(ohneText?.weg, 'nummer');
  assert.equal(ohneText?.anfrage?.id, 'a1');
});

test('Zuordnung über die Anfragenummer (Chat von einer anderen Nummer)', async () => {
  const { abfrage, anlegen } = datenbank();
  anlegen('a1', '0170 1234567', 'K7M2QX');
  anlegen('a2', null, 'HJK789');
  const z = await anfrageZuordnen(abfrage, '4915112345678', TEXT('K7M2QX'), JETZT);
  assert.equal(z?.weg, 'anfragenummer');
  assert.equal(z?.anfrage?.id, 'a1');
  assert.equal(z?.anfragenummer, 'K7M2QX');
  const ohneTelefon = await anfrageZuordnen(abfrage, '4915112345678', TEXT('HJK789'), JETZT);
  assert.equal(ohneTelefon?.anfrage?.id, 'a2');
});

test('Absendernummer geht vor Anfragenummer', async () => {
  const { abfrage, anlegen } = datenbank();
  anlegen('a1', '+49 170 1234567', 'AAA222');
  anlegen('a2', '0160 5555555', 'BBB333');
  const z = await anfrageZuordnen(abfrage, '491701234567', TEXT('BBB333'), JETZT);
  assert.equal(z?.weg, 'nummer');
  assert.equal(z?.anfrage?.id, 'a1');
});

test('Kein Treffer: Text der Landingpage wird nicht zugeordnet, normaler Kundenchat bleibt unberührt', async () => {
  const { abfrage, anlegen } = datenbank();
  anlegen('a1', '0170 1234567', 'K7M2QX');
  const unbekannt = await anfrageZuordnen(abfrage, '4915112345678', TEXT('QQQ999'), JETZT);
  assert.equal(unbekannt?.weg, 'keine');
  assert.equal(unbekannt?.anfrage, null);
  assert.equal(unbekannt?.anfragenummer, 'QQQ999');
  const ohneNummer = await anfrageZuordnen(abfrage, '4915112345678', 'Hi, ich wollte wegen dem Website Entwurf fragen', JETZT);
  assert.equal(ohneNummer?.weg, 'keine');
  assert.equal(await anfrageZuordnen(abfrage, '4915112345678', 'Hallo, ist meine Bestellung schon fertig?', JETZT), null);
  assert.equal(istEntwurfNachricht('Hallo, ist meine Bestellung schon fertig?'), false);
});

test('Fristen: Nummer 30 Tage, Anfragenummer 90 Tage', async () => {
  const { abfrage, anlegen } = datenbank();
  anlegen('alt', '0170 1234567', 'MNP234', 45);
  const perNummer = await anfrageZuordnen(abfrage, '491701234567', 'Hallo!', JETZT);
  assert.equal(perNummer, null, 'nach 30 Tagen zählt die Nummer allein nicht mehr');
  const perText = await anfrageZuordnen(abfrage, '491701234567', TEXT('MNP234'), JETZT);
  assert.equal(perText?.weg, 'anfragenummer');
  assert.equal(perText?.anfrage?.id, 'alt');
});

test('Defekte Antworten stören die Suche nicht', async () => {
  const { abfrage, anlegen } = datenbank();
  anlegen('a1', null, 'K7M2QX');
  const db = abfrage;
  await db("INSERT INTO anfragen (id, nutzer_id, quelle, name, email, antworten, erstellt_am) VALUES ('kaputt', 'buero', 'website-entwurf', 'X', 'x@example.com', 'kein json', ?)", JETZT.toISOString());
  const z = await anfrageZuordnen(abfrage, '4915112345678', TEXT('K7M2QX'), JETZT);
  assert.equal(z?.anfrage?.id, 'a1');
});

test('Angaben der Anfrage für die Begrüßung', () => {
  const mit = angabenDerAnfrage({
    antworten: JSON.stringify([
      { frage: 'Hat schon eine Website', antwort: 'Ja' },
      { frage: 'Website', antwort: 'becker-bau.de' },
      { frage: 'Anfragenummer', antwort: 'K7M2QX' },
      { frage: 'Kontaktweg', antwort: 'Anruf' },
    ]),
  });
  assert.deepEqual(mit, { website: 'becker-bau.de', hatWebsite: true, anfragenummer: 'K7M2QX', kontaktweg: 'Anruf' });
  const ohne = angabenDerAnfrage({ antworten: JSON.stringify([{ frage: 'Hat schon eine Website', antwort: 'Nein' }]) });
  assert.equal(ohne.hatWebsite, false);
  assert.equal(angabenDerAnfrage({ antworten: 'kaputt' }).hatWebsite, false);
});
