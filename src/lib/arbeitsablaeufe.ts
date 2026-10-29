/**
 * Arbeitsabläufe wie bei Calendly: Wenn etwas passiert (Buchung, vor Beginn, nach Ende, Absage, nicht erschienen),
 * geht eine Mail an den Gast, das Büro oder andere Adressen. Ein Ablauf gilt für einzelne oder alle Terminarten.
 * Sofortige Abläufe laufen direkt bei der Buchung, Absage oder Markierung, zeitversetzte im Cron alle zehn Minuten.
 * Jede Buchung bekommt jeden Ablauf höchstens einmal (arbeitsablauf_versand).
 */
import { alle, ausfuehren, db, eins, jetztIso, neueId } from './db';
import { emailGueltig, trimmen } from './eingabe';
import { mailArbeitsablauf, mailSenden, terminDetailsVon, type KnopfArt } from './mail';
import { ORT_LABEL, type Buchung, type Nutzer, type Terminart } from './typen';
import { formatDatumLang, formatZeit } from './zeit';

export type Ausloeser = 'nach_buchung' | 'vor_beginn' | 'nach_ende' | 'bei_absage' | 'nicht_erschienen';
export type Aktion = 'mail_gast' | 'mail_buero' | 'mail_an';

export interface Arbeitsablauf {
  id: string;
  nutzer_id: string;
  name: string;
  ausloeser: Ausloeser;
  versatz_min: number;
  aktion: Aktion;
  empfaenger: string | null;
  betreff: string;
  ueberschrift: string | null;
  text: string;
  alle_terminarten: number;
  aktiv: number;
  erstellt_am: string;
  aktualisiert_am: string;
}

export type ArbeitsablaufMitZuordnung = Arbeitsablauf & { terminarten: string[] };

export const AUSLOESER: { wert: Ausloeser; text: string; hilfe: string }[] = [
  { wert: 'nach_buchung', text: 'Nach der Buchung', hilfe: 'Sofort oder eine Weile nach einer neuen Buchung oder Umbuchung' },
  { wert: 'vor_beginn', text: 'Vor Beginn des Termins', hilfe: 'Erinnerung, zum Beispiel 24 Stunden vorher' },
  { wert: 'nach_ende', text: 'Nach Ende des Termins', hilfe: 'Zum Beispiel Dank und nächste Schritte' },
  { wert: 'bei_absage', text: 'Bei einer Absage', hilfe: 'Sofort, wenn Gast oder Team absagt' },
  { wert: 'nicht_erschienen', text: 'Wenn der Gast nicht erschienen ist', hilfe: 'Sofort, wenn ihr den Termin so markiert' },
];

export const AKTIONEN: { wert: Aktion; text: string }[] = [
  { wert: 'mail_gast', text: 'Mail an den Gast' },
  { wert: 'mail_buero', text: 'Mail an das Büro' },
  { wert: 'mail_an', text: 'Mail an jemand anderen' },
];

/** Erlaubte Abstände je Auslöser in Minuten. 0 bedeutet sofort. */
export const VERSATZ: Record<Ausloeser, number[]> = {
  nach_buchung: [0, 30, 60, 120, 1440, 2880],
  vor_beginn: [10080, 4320, 2880, 1440, 720, 240, 120, 60, 30, 15],
  nach_ende: [0, 30, 60, 120, 1440, 2880, 10080],
  bei_absage: [0],
  nicht_erschienen: [0],
};

export function dauerText(min: number) {
  if (min === 0) return 'Sofort';
  if (min % 1440 === 0 && min >= 4320) return `${min / 1440} Tage`;
  if (min % 60 === 0) return min === 60 ? '1 Stunde' : `${min / 60} Stunden`;
  return `${min} Minuten`;
}

/** „Wenn das passiert“ in einer Zeile */
export function wennText(w: Pick<Arbeitsablauf, 'ausloeser' | 'versatz_min'>) {
  const d = dauerText(w.versatz_min);
  switch (w.ausloeser) {
    case 'nach_buchung':
      return w.versatz_min ? `${d} nach der Buchung` : 'Sofort nach der Buchung';
    case 'vor_beginn':
      return `${d} vor Beginn des Termins`;
    case 'nach_ende':
      return w.versatz_min ? `${d} nach Ende des Termins` : 'Direkt nach Ende des Termins';
    case 'bei_absage':
      return 'Sofort bei einer Absage';
    case 'nicht_erschienen':
      return 'Sofort, wenn der Gast als nicht erschienen markiert wird';
  }
}

/** „Das tun“ in einer Zeile */
export function tunText(w: Pick<Arbeitsablauf, 'aktion' | 'empfaenger'>, bueroEmail?: string) {
  if (w.aktion === 'mail_gast') return 'Mail an den Gast';
  if (w.aktion === 'mail_buero') return bueroEmail ? `Mail an das Büro (${bueroEmail})` : 'Mail an das Büro';
  return `Mail an ${empfaengerLesen(w.empfaenger).join(', ') || 'niemanden (Adresse fehlt)'}`;
}

export function empfaengerLesen(text: string | null) {
  return [...new Set((text ?? '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

/** Platzhalter für Betreff, Überschrift und Text */
export const PLATZHALTER: { name: string; text: string }[] = [
  { name: 'vorname', text: 'Vorname des Gasts' },
  { name: 'name', text: 'Name des Gasts' },
  { name: 'email', text: 'E Mail des Gasts' },
  { name: 'telefon', text: 'Telefon des Gasts' },
  { name: 'terminart', text: 'Titel der Terminart' },
  { name: 'datum', text: 'Datum, z. B. Montag, 3. November 2026' },
  { name: 'uhrzeit', text: 'Beginn, z. B. 10:00' },
  { name: 'wann', text: '„in einer Stunde“ oder „am Montag, 3. November“' },
  { name: 'dauer', text: 'Dauer in Minuten' },
  { name: 'ort', text: 'Ort oder Art des Termins' },
  { name: 'meeting_link', text: 'Link zum Meeting' },
  { name: 'verwalten_link', text: 'Link zum Umbuchen oder Absagen' },
  { name: 'buchen_link', text: 'Link zur Buchungsseite der Terminart' },
  { name: 'absagegrund', text: 'Grund der Absage' },
  { name: 'nachricht', text: 'Nachricht des Gasts' },
];

const intern = (aktion: Aktion) => aktion !== 'mail_gast';

/** Vorschlag für Betreff, Überschrift und Text, je nach Auslöser und Empfänger */
export function vorlage(ausloeser: Ausloeser, aktion: Aktion): { betreff: string; ueberschrift: string; text: string } {
  if (intern(aktion)) {
    const T = {
      nach_buchung: ['Neue Buchung: {name}, {terminart} {wann}', '{name} hat gebucht', 'Hallo,\n\n{name} hat {terminart} am {datum} um {uhrzeit} Uhr gebucht.\n\nE Mail: {email}\nTelefon: {telefon}\nNachricht: {nachricht}'],
      vor_beginn: ['Gleich: {terminart} mit {name} {wann}', '{terminart} mit {name}', 'Hallo,\n\n{terminart} mit {name} beginnt {wann}.\n\nE Mail: {email}\nTelefon: {telefon}'],
      nach_ende: ['Nachfassen: {name}, {terminart}', 'Zeit zum Nachfassen', 'Hallo,\n\n{terminart} mit {name} ist vorbei. Denkt an das Angebot oder die nächsten Schritte.\n\nE Mail: {email}\nTelefon: {telefon}'],
      bei_absage: ['Abgesagt: {name}, {terminart} am {datum}', '{name} hat abgesagt', 'Hallo,\n\nder Termin {terminart} mit {name} am {datum} um {uhrzeit} Uhr ist abgesagt.\n\nGrund: {absagegrund}'],
      nicht_erschienen: ['Nicht erschienen: {name}, {terminart}', '{name} ist nicht erschienen', 'Hallo,\n\n{name} ist zu {terminart} am {datum} nicht erschienen. Vielleicht kurz anrufen?\n\nE Mail: {email}\nTelefon: {telefon}'],
    }[ausloeser];
    return { betreff: T[0], ueberschrift: T[1], text: T[2] };
  }
  const T = {
    nach_buchung: ['Kurz vor deinem Termin: {terminart}', 'Schön, dass du gebucht hast', 'Hallo {vorname},\n\nwir freuen uns auf {terminart} am {datum} um {uhrzeit} Uhr. Überleg dir gern vorab, was dir am wichtigsten ist, dann holen wir das Meiste aus der Zeit heraus.'],
    vor_beginn: ['Erinnerung: {terminart} {wann}', 'Wir sehen uns {wann}', 'Hallo {vorname},\n\nkurze Erinnerung an deinen Termin. Falls etwas dazwischenkommt, buche einfach um.'],
    nach_ende: ['Danke für das Gespräch', 'Danke für deine Zeit', 'Hallo {vorname},\n\ndanke für das Gespräch. Wir melden uns in Kürze mit den nächsten Schritten. Bis dahin: Antworte einfach auf diese Mail, wenn dir noch etwas einfällt.'],
    bei_absage: ['Schade, dass es nicht klappt', 'Neuer Termin gefällig?', 'Hallo {vorname},\n\ndein Termin {terminart} am {datum} ist abgesagt. Wenn du magst, such dir einfach eine neue Zeit aus.'],
    nicht_erschienen: ['Schade, dass es nicht geklappt hat', 'Wir haben dich vermisst', 'Hallo {vorname},\n\nzu deinem Termin {terminart} am {datum} haben wir uns leider verpasst. Kein Problem: Such dir einfach eine neue Zeit aus, wir freuen uns auf das Gespräch.'],
  }[ausloeser];
  return { betreff: T[0], ueberschrift: T[1], text: T[2] };
}

const EYEBROW: Record<Ausloeser, [string, string]> = {
  nach_buchung: ['Dein Termin', 'Neuer Termin'],
  vor_beginn: ['Erinnerung', 'Termin steht an'],
  nach_ende: ['Nach dem Termin', 'Nach dem Termin'],
  bei_absage: ['Termin abgesagt', 'Termin abgesagt'],
  nicht_erschienen: ['Termin verpasst', 'Nicht erschienen'],
};

/* Lesen */

export async function ablaeufeVon(nutzerId: string): Promise<ArbeitsablaufMitZuordnung[]> {
  const [liste, zuordnung] = await Promise.all([
    alle<Arbeitsablauf>(
      `SELECT * FROM arbeitsablaeufe WHERE nutzer_id = ?
       ORDER BY aktiv DESC, CASE ausloeser WHEN 'nach_buchung' THEN 1 WHEN 'vor_beginn' THEN 2 WHEN 'nach_ende' THEN 3 WHEN 'bei_absage' THEN 4 ELSE 5 END,
         versatz_min DESC, name`,
      nutzerId,
    ),
    alle<{ arbeitsablauf_id: string; terminart_id: string }>(
      'SELECT z.* FROM arbeitsablauf_terminarten z JOIN arbeitsablaeufe a ON a.id = z.arbeitsablauf_id WHERE a.nutzer_id = ?',
      nutzerId,
    ),
  ]);
  return liste.map((a) => ({ ...a, terminarten: zuordnung.filter((z) => z.arbeitsablauf_id === a.id).map((z) => z.terminart_id) }));
}

export async function ablaufNachId(nutzerId: string, id: string): Promise<ArbeitsablaufMitZuordnung | null> {
  const a = await eins<Arbeitsablauf>('SELECT * FROM arbeitsablaeufe WHERE id = ? AND nutzer_id = ?', id, nutzerId);
  if (!a) return null;
  const z = await alle<{ terminart_id: string }>('SELECT terminart_id FROM arbeitsablauf_terminarten WHERE arbeitsablauf_id = ?', id);
  return { ...a, terminarten: z.map((x) => x.terminart_id) };
}

export const giltFuer = (a: ArbeitsablaufMitZuordnung, terminartId: string) => Boolean(a.alle_terminarten) || a.terminarten.includes(terminartId);

/** Versendete Mails je Ablauf in den letzten 30 Tagen */
export async function versandZaehlen(nutzerId: string) {
  const zeilen = await alle<{ id: string; n: number }>(
    `SELECT v.arbeitsablauf_id AS id, COUNT(*) AS n FROM arbeitsablauf_versand v JOIN arbeitsablaeufe a ON a.id = v.arbeitsablauf_id
     WHERE a.nutzer_id = ? AND v.status = 'gesendet' AND v.gesendet_am > ? GROUP BY v.arbeitsablauf_id`,
    nutzerId,
    new Date(Date.now() - 30 * 86_400_000).toISOString(),
  );
  return new Map(zeilen.map((z) => [z.id, z.n]));
}

/** Verlauf einer Buchung für die Termindetails */
export function versandVonBuchung(buchungId: string) {
  return alle<{ name: string; status: string; gesendet_am: string; ausloeser: Ausloeser; versatz_min: number; aktion: Aktion }>(
    `SELECT a.name, a.ausloeser, a.versatz_min, a.aktion, v.status, v.gesendet_am FROM arbeitsablauf_versand v
     JOIN arbeitsablaeufe a ON a.id = v.arbeitsablauf_id WHERE v.buchung_id = ? ORDER BY v.gesendet_am`,
    buchungId,
  );
}

/* Formular */

export type ArbeitsablaufWerte = Pick<Arbeitsablauf, 'name' | 'ausloeser' | 'versatz_min' | 'aktion' | 'empfaenger' | 'betreff' | 'ueberschrift' | 'text' | 'alle_terminarten' | 'aktiv'> & {
  terminarten: string[];
};

export const STANDARD_ABLAUF: ArbeitsablaufWerte = {
  name: '',
  ausloeser: 'vor_beginn',
  versatz_min: 1440,
  aktion: 'mail_gast',
  empfaenger: '',
  ...vorlage('vor_beginn', 'mail_gast'),
  alle_terminarten: 1,
  aktiv: 1,
  terminarten: [],
};

export function ablaufAusFormular(form: FormData, erlaubteTerminarten: string[]) {
  const fehler: Record<string, string> = {};
  const ausloeser = (AUSLOESER.some((a) => a.wert === form.get('ausloeser')) ? form.get('ausloeser') : 'vor_beginn') as Ausloeser;
  const aktion = (AKTIONEN.some((a) => a.wert === form.get('aktion')) ? form.get('aktion') : 'mail_gast') as Aktion;
  const versatzRoh = Number(form.get(`versatz_${ausloeser}`) ?? form.get('versatz_min'));
  const versatz = VERSATZ[ausloeser].includes(versatzRoh) ? versatzRoh : VERSATZ[ausloeser][0]!;
  const empfaenger = empfaengerLesen(trimmen(form.get('empfaenger'), 600));
  const erlaubt = new Set(erlaubteTerminarten);
  const werte: ArbeitsablaufWerte = {
    name: trimmen(form.get('name'), 120),
    ausloeser,
    versatz_min: versatz,
    aktion,
    empfaenger: aktion === 'mail_an' ? empfaenger.join(', ') : null,
    betreff: trimmen(form.get('betreff'), 200),
    ueberschrift: trimmen(form.get('ueberschrift'), 160) || null,
    text: String(form.get('text') ?? '').replace(/\r\n/g, '\n').trim().slice(0, 5000),
    alle_terminarten: form.get('alle_terminarten') ? 1 : 0,
    aktiv: form.get('aktiv') ? 1 : 0,
    terminarten: [...new Set(form.getAll('terminarten').map(String))].filter((id) => erlaubt.has(id)),
  };
  if (werte.name.length < 2) fehler.name = 'Bitte gib dem Arbeitsablauf einen Namen.';
  if (werte.betreff.length < 2) fehler.betreff = 'Bitte gib einen Betreff an.';
  if (werte.text.length < 2) fehler.text = 'Bitte schreib einen Text für die Mail.';
  if (aktion === 'mail_an') {
    if (empfaenger.length === 0) fehler.empfaenger = 'Bitte gib mindestens eine E Mail Adresse an.';
    else if (empfaenger.length > 5) fehler.empfaenger = 'Höchstens fünf Adressen.';
    else if (empfaenger.some((e) => !emailGueltig(e))) fehler.empfaenger = `Ungültige Adresse: ${empfaenger.find((e) => !emailGueltig(e))}`;
  }
  return { werte, fehler };
}

export async function ablaufSpeichern(nutzerId: string, w: ArbeitsablaufWerte, id?: string) {
  const jetzt = jetztIso();
  const d = db();
  const ablaufId = id ?? neueId();
  const felder = [w.name, w.ausloeser, w.versatz_min, w.aktion, w.empfaenger, w.betreff, w.ueberschrift, w.text, w.alle_terminarten, w.aktiv] as const;
  const befehle = [
    id
      ? d.prepare(
          `UPDATE arbeitsablaeufe SET name = ?, ausloeser = ?, versatz_min = ?, aktion = ?, empfaenger = ?, betreff = ?, ueberschrift = ?, text = ?,
            alle_terminarten = ?, aktiv = ?, aktualisiert_am = ? WHERE id = ? AND nutzer_id = ?`,
        ).bind(...felder, jetzt, ablaufId, nutzerId)
      : d.prepare(
          `INSERT INTO arbeitsablaeufe (name, ausloeser, versatz_min, aktion, empfaenger, betreff, ueberschrift, text, alle_terminarten, aktiv,
            erstellt_am, aktualisiert_am, id, nutzer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(...felder, jetzt, jetzt, ablaufId, nutzerId),
    d.prepare('DELETE FROM arbeitsablauf_terminarten WHERE arbeitsablauf_id = ?').bind(ablaufId),
    ...(w.alle_terminarten ? [] : w.terminarten).map((t) =>
      d.prepare('INSERT OR IGNORE INTO arbeitsablauf_terminarten (arbeitsablauf_id, terminart_id) VALUES (?, ?)').bind(ablaufId, t),
    ),
  ];
  await d.batch(befehle);
  return ablaufId;
}

export async function ablaufDuplizieren(nutzerId: string, id: string) {
  const a = await ablaufNachId(nutzerId, id);
  if (!a) return null;
  return ablaufSpeichern(nutzerId, { ...a, name: `${a.name} (Kopie)`, aktiv: 0 });
}

export async function ablaufLoeschen(nutzerId: string, id: string) {
  const d = db();
  await d.batch([
    d.prepare('DELETE FROM arbeitsablauf_versand WHERE arbeitsablauf_id = ? AND EXISTS (SELECT 1 FROM arbeitsablaeufe WHERE id = ? AND nutzer_id = ?)').bind(id, id, nutzerId),
    d.prepare('DELETE FROM arbeitsablauf_terminarten WHERE arbeitsablauf_id = ? AND EXISTS (SELECT 1 FROM arbeitsablaeufe WHERE id = ? AND nutzer_id = ?)').bind(id, id, nutzerId),
    d.prepare('DELETE FROM arbeitsablaeufe WHERE id = ? AND nutzer_id = ?').bind(id, nutzerId),
  ]);
}

/**
 * Zuordnung aus dem Terminart Editor: Die gewählten Abläufe gelten für diese Terminart, die übrigen nicht.
 * Wird ein Ablauf für alle Terminarten hier abgewählt, gilt er danach für alle anderen einzeln.
 */
export async function zuordnungFuerTerminart(nutzerId: string, terminartId: string, gewaehlt: string[]) {
  const [ablaeufe, arten] = await Promise.all([
    ablaeufeVon(nutzerId),
    alle<{ id: string }>('SELECT id FROM terminarten WHERE nutzer_id = ?', nutzerId),
  ]);
  const wahl = new Set(gewaehlt);
  const d = db();
  const befehle: D1PreparedStatement[] = [];
  for (const a of ablaeufe) {
    const soll = wahl.has(a.id);
    if (soll === giltFuer(a, terminartId)) continue;
    if (soll) {
      befehle.push(d.prepare('INSERT OR IGNORE INTO arbeitsablauf_terminarten (arbeitsablauf_id, terminart_id) VALUES (?, ?)').bind(a.id, terminartId));
    } else if (a.alle_terminarten) {
      befehle.push(d.prepare('UPDATE arbeitsablaeufe SET alle_terminarten = 0, aktualisiert_am = ? WHERE id = ?').bind(jetztIso(), a.id));
      for (const t of arten) {
        if (t.id !== terminartId) befehle.push(d.prepare('INSERT OR IGNORE INTO arbeitsablauf_terminarten (arbeitsablauf_id, terminart_id) VALUES (?, ?)').bind(a.id, t.id));
      }
    } else {
      befehle.push(d.prepare('DELETE FROM arbeitsablauf_terminarten WHERE arbeitsablauf_id = ? AND terminart_id = ?').bind(a.id, terminartId));
    }
  }
  if (befehle.length) await d.batch(befehle);
}

/* Ausführen */

function wannText(b: Pick<Buchung, 'start_utc'>, tz: string, jetzt = Date.now()) {
  const rest = (Date.parse(b.start_utc) - jetzt) / 60_000;
  if (rest > 0 && rest <= 40) return 'gleich';
  if (rest > 0 && rest <= 90) return 'in einer Stunde';
  return `am ${formatDatumLang(b.start_utc, tz).replace(/ \d{4}$/, '')}`;
}

export function platzhalterWerte(b: Buchung, ta: Terminart, basis: string, tz: string): Record<string, string> {
  return {
    vorname: b.gast_name.trim().split(/\s+/)[0] ?? b.gast_name,
    name: b.gast_name,
    email: b.gast_email,
    telefon: b.gast_telefon ?? '',
    terminart: ta.titel,
    datum: formatDatumLang(b.start_utc, tz),
    uhrzeit: formatZeit(b.start_utc, tz),
    wann: wannText(b, tz),
    dauer: String(ta.dauer_min),
    ort: b.meeting_url ? 'Google Meet' : (b.ort_text ?? ORT_LABEL[ta.ort_typ] ?? ''),
    meeting_link: b.meeting_url ?? '',
    verwalten_link: `${basis}/termin/${b.id}`,
    buchen_link: `${basis}/${ta.slug}`,
    absagegrund: b.storno_grund ?? '',
    nachricht: b.nachricht ?? '',
  };
}

/** Ersetzt {platzhalter}. Zeilen, die nur aus „Label: {leer}“ bestehen, fallen weg. */
export function platzhalterErsetzen(text: string, werte: Record<string, string>) {
  return text
    .split('\n')
    .filter((zeile) => {
      const m = zeile.match(/^[^{}]*:\s*\{([a-z_]+)\}\s*$/);
      return !m || !(m[1]! in werte) || werte[m[1]!] !== '';
    })
    .join('\n')
    .replace(/\{([a-z_]+)\}/g, (ganz, name: string) => (name in werte ? werte[name]! : ganz));
}

/** Baut die Mail eines Ablaufs für eine Buchung und schickt sie. */
export async function ablaufMailSenden(a: Arbeitsablauf, b: Buchung, ta: Terminart, n: Nutzer, basis: string, anTest?: string) {
  const gast = a.aktion === 'mail_gast';
  const tz = gast ? b.gast_zeitzone : n.zeitzone;
  const werte = platzhalterWerte(b, ta, basis, tz);
  const ersetzen = (t: string) => platzhalterErsetzen(t, werte);
  const an = anTest ?? (gast ? b.gast_email : a.aktion === 'mail_buero' ? n.email : empfaengerLesen(a.empfaenger));
  if (Array.isArray(an) && an.length === 0) throw new Error('Keine Empfänger hinterlegt');
  const vorbei = Date.parse(b.start_utc) < Date.now();
  const knoepfe: { href: string; text: string; art: KnopfArt }[] = [];
  if (!gast) knoepfe.push({ href: `${basis}/app/termine/${b.id}`, text: 'Im Backoffice öffnen', art: 'schwarz' });
  else if (b.status === 'bestaetigt' && !vorbei && (a.ausloeser === 'nach_buchung' || a.ausloeser === 'vor_beginn')) {
    if (b.meeting_url) knoepfe.push({ href: b.meeting_url, text: 'Zum Meeting', art: 'gruen' });
    knoepfe.push({ href: `${basis}/termin/${b.id}`, text: 'Umbuchen oder absagen', art: 'rahmen' });
  } else if (a.ausloeser !== 'nach_buchung' && a.ausloeser !== 'vor_beginn') {
    knoepfe.push({ href: `${basis}/${ta.slug}`, text: 'Neuen Termin buchen', art: 'orange' });
  }
  const betreff = ersetzen(a.betreff).replace(/\s+/g, ' ').trim();
  await mailSenden({
    an,
    antwortAn: gast ? n.email : b.gast_email,
    betreff: anTest ? `[Test] ${betreff}` : betreff,
    html: mailArbeitsablauf(basis, {
      vorschau: betreff,
      eyebrow: EYEBROW[a.ausloeser][gast ? 0 : 1],
      ueberschrift: ersetzen(a.ueberschrift ?? ''),
      text: ersetzen(a.text),
      // Nach dem Termin ist der Meetinglink nur noch verwirrend
      details: vorbei ? { ...terminDetailsVon(b, ta, n, tz), meetingUrl: null, ort: b.meeting_url ? 'Google Meet' : b.ort_text } : terminDetailsVon(b, ta, n, tz),
      knoepfe,
    }),
  });
}

/** Reserviert den Versand, damit nichts doppelt rausgeht. true, wenn diese Buchung den Ablauf noch nicht hatte. */
async function versandReservieren(ablaufId: string, buchungId: string, status: 'gesendet' | 'entfallen') {
  const r = await ausfuehren(
    'INSERT OR IGNORE INTO arbeitsablauf_versand (arbeitsablauf_id, buchung_id, status, gesendet_am) VALUES (?, ?, ?, ?)',
    ablaufId, buchungId, status, jetztIso(),
  );
  return (r.meta?.changes ?? 0) > 0;
}

const GILT_FUER_SQL = `(a.alle_terminarten = 1 OR EXISTS (SELECT 1 FROM arbeitsablauf_terminarten z WHERE z.arbeitsablauf_id = a.id AND z.terminart_id = ?))`;

/** Sofortige Abläufe: bei Buchung, Absage und „nicht erschienen“. Fehler werden protokolliert, nie geworfen. */
export async function ablaeufeAusloesen(ausloeser: 'nach_buchung' | 'bei_absage' | 'nicht_erschienen', b: Buchung, ta: Terminart, n: Nutzer, basis: string) {
  const liste = await alle<Arbeitsablauf>(
    `SELECT a.* FROM arbeitsablaeufe a WHERE a.nutzer_id = ? AND a.aktiv = 1 AND a.ausloeser = ? AND a.versatz_min = 0 AND ${GILT_FUER_SQL}`,
    n.id, ausloeser, ta.id,
  ).catch((f) => {
    console.error('Arbeitsabläufe nicht lesbar', f);
    return [];
  });
  for (const a of liste) {
    if (!(await versandReservieren(a.id, b.id, 'gesendet'))) continue;
    try {
      await ablaufMailSenden(a, b, ta, n, basis);
    } catch (fehler) {
      console.error('Arbeitsablauf fehlgeschlagen', a.name, b.id, fehler);
      await ausfuehren("UPDATE arbeitsablauf_versand SET status = 'fehler' WHERE arbeitsablauf_id = ? AND buchung_id = ?", a.id, b.id);
    }
  }
}

/**
 * Zeitversetzte Abläufe im Cron: vor Beginn, nach Ende und verzögert nach der Buchung.
 * Fällt ein Zeitpunkt vor die Buchung oder vor das Anlegen des Ablaufs, entfällt die Mail.
 * Sind mehrere Erinnerungen an den Gast gleichzeitig fällig, geht nur die kürzeste raus.
 */
export async function ablaeufeImCron(basis: string) {
  const jetzt = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const ZWEI_TAGE = 2 * 86_400_000;
  const ablaeufe = await alle<Arbeitsablauf>(
    `SELECT * FROM arbeitsablaeufe WHERE aktiv = 1 AND (ausloeser IN ('vor_beginn', 'nach_ende') OR (ausloeser = 'nach_buchung' AND versatz_min > 0))`,
  );
  const faellig: { a: Arbeitsablauf; b: Buchung; zeitpunkt: number }[] = [];
  for (const a of ablaeufe) {
    const x = a.versatz_min * 60_000;
    const [bedingung, werte, zeitpunkt]: [string, string[], (b: Buchung) => number] =
      a.ausloeser === 'vor_beginn'
        ? ['b.start_utc > ? AND b.start_utc <= ?', [iso(jetzt), iso(jetzt + x)], (b) => Date.parse(b.start_utc) - x]
        : a.ausloeser === 'nach_ende'
          ? ['b.nicht_erschienen = 0 AND b.ende_utc <= ? AND b.ende_utc > ?', [iso(jetzt - x), iso(jetzt - x - ZWEI_TAGE)], (b) => Date.parse(b.ende_utc) + x]
          : ['b.start_utc > ? AND b.erstellt_am <= ? AND b.erstellt_am > ?', [iso(jetzt), iso(jetzt - x), iso(jetzt - x - ZWEI_TAGE)], (b) => Date.parse(b.erstellt_am) + x];
    const buchungen = await alle<Buchung>(
      `SELECT b.* FROM buchungen b, arbeitsablaeufe a WHERE a.id = ? AND b.nutzer_id = a.nutzer_id AND b.status = 'bestaetigt'
         AND (a.alle_terminarten = 1 OR EXISTS (SELECT 1 FROM arbeitsablauf_terminarten z WHERE z.arbeitsablauf_id = a.id AND z.terminart_id = b.terminart_id))
         AND NOT EXISTS (SELECT 1 FROM arbeitsablauf_versand v WHERE v.arbeitsablauf_id = a.id AND v.buchung_id = b.id)
         AND ${bedingung} ORDER BY b.start_utc LIMIT 200`,
      a.id, ...werte,
    );
    for (const b of buchungen) faellig.push({ a, b, zeitpunkt: zeitpunkt(b) });
  }

  // Erinnerungen an den Gast je Buchung: nur die kürzeste
  const kuerzeste = new Map<string, number>();
  for (const f of faellig) {
    if (f.a.ausloeser !== 'vor_beginn' || f.a.aktion !== 'mail_gast') continue;
    const vorher = kuerzeste.get(f.b.id);
    if (vorher === undefined || f.a.versatz_min < vorher) kuerzeste.set(f.b.id, f.a.versatz_min);
  }

  const cache = new Map<string, Terminart | Nutzer | null>();
  const laden = async <T,>(tabelle: 'terminarten' | 'nutzer', id: string) => {
    const k = `${tabelle}:${id}`;
    if (!cache.has(k)) cache.set(k, await eins<T & { id: string }>(`SELECT * FROM ${tabelle} WHERE id = ?`, id) as never);
    return cache.get(k) as T | null;
  };

  let gesendet = 0;
  let entfallen = 0;
  for (const { a, b, zeitpunkt } of faellig) {
    const zuSpaet = zeitpunkt < Date.parse(b.erstellt_am) || zeitpunkt < Date.parse(a.erstellt_am) - 15 * 60_000;
    const ueberholt = a.ausloeser === 'vor_beginn' && a.aktion === 'mail_gast' && kuerzeste.get(b.id) !== a.versatz_min;
    if (zuSpaet || ueberholt) {
      await versandReservieren(a.id, b.id, 'entfallen');
      entfallen++;
      continue;
    }
    const [ta, n] = await Promise.all([laden<Terminart>('terminarten', b.terminart_id), laden<Nutzer>('nutzer', b.nutzer_id)]);
    if (!ta || !n) continue;
    if (!(await versandReservieren(a.id, b.id, 'gesendet'))) continue;
    try {
      await ablaufMailSenden(a, b, ta, n, basis);
      gesendet++;
    } catch (fehler) {
      // Beim nächsten Lauf neu versuchen
      console.error('Arbeitsablauf im Cron fehlgeschlagen', a.name, b.id, fehler);
      await ausfuehren('DELETE FROM arbeitsablauf_versand WHERE arbeitsablauf_id = ? AND buchung_id = ?', a.id, b.id);
    }
  }
  return { gesendet, entfallen };
}

/** Testmail mit einem Beispieltermin in drei Tagen um 10 Uhr */
export async function ablaufTesten(a: Arbeitsablauf, n: Nutzer, ta: Terminart, an: string, basis: string) {
  const start = new Date(Date.now() + 3 * 86_400_000);
  start.setUTCHours(9, 0, 0, 0);
  const ende = new Date(start.getTime() + ta.dauer_min * 60_000);
  const beispiel: Buchung = {
    id: 'beispiel', terminart_id: ta.id, nutzer_id: n.id, start_utc: start.toISOString(), ende_utc: ende.toISOString(),
    gast_name: 'Max Mustermann', gast_email: 'max@beispiel.de', gast_telefon: '0209 1234567', gast_zeitzone: n.zeitzone,
    antworten: '[]', nachricht: 'Wir möchten mehr Anfragen über unsere Website bekommen.',
    status: a.ausloeser === 'bei_absage' ? 'storniert' : 'bestaetigt', storno_grund: a.ausloeser === 'bei_absage' ? 'Kurzfristig verhindert' : null,
    storniert_von: null, storniert_am: null, umgebucht_von: null, umgebucht_zu: null, nicht_erschienen: 0, interne_notiz: null,
    ort_text: ta.ort_typ === 'google_meet' ? 'Google Meet' : ORT_LABEL[ta.ort_typ], meeting_url: ta.ort_typ === 'google_meet' ? 'https://meet.google.com/abc-defg-hij' : null,
    google_event_id: null, erinnerung_gesendet: 0, erinnerungen_gesendet: '[]', quelle: null, loeschen_ab: ende.toISOString(),
    erstellt_am: jetztIso(), aktualisiert_am: jetztIso(),
  };
  await ablaufMailSenden(a, beispiel, ta, n, basis, an);
}

/** Liste für den Terminart Editor. Ohne terminartId (neue Terminart) sind die Abläufe für alle Terminarten gewählt. */
export async function ablaufWahl(n: Nutzer, terminartId?: string, gewaehlt?: string[]) {
  const liste = await ablaeufeVon(n.id);
  const wahl = gewaehlt ? new Set(gewaehlt) : null;
  return liste.map((a) => ({
    id: a.id,
    name: a.name,
    wenn: wennText(a),
    tun: tunText(a),
    aktiv: Boolean(a.aktiv),
    alle: Boolean(a.alle_terminarten),
    gewaehlt: wahl ? wahl.has(a.id) : terminartId ? giltFuer(a, terminartId) : Boolean(a.alle_terminarten),
  }));
}
