/**
 * Buchungsablauf: anlegen, absagen, umbuchen. Reihenfolge beim Anlegen:
 * speichern, Google Termin anlegen, dann Mails und Webhook im Hintergrund.
 */
import { env } from 'cloudflare:workers';
import { ablaeufeAusloesen, ablaeufeImCron } from './arbeitsablaeufe';
import { ausfuehren, eins, jetztIso, neueId } from './db';
import { googleAbgleichBuero, googleTerminAnlegen, googleTerminLoeschen } from './google';
import { icsDatei } from './ics';
import { herkunft } from './herkunft';
import { kontaktAusBuchung } from './kontakte';
import { playbookZugaengeAufraeumen } from './playbooks';
import { base64Utf8, mailGastBestaetigung, mailGastgeberNeu, mailSenden, mailStorno, terminDetailsVon } from './mail';
import { ORT_LABEL, type Buchung, type Nutzer, type Terminart } from './typen';
import { formatDatumLang } from './zeit';

export class SlotVergeben extends Error {
  constructor() {
    super('Dieser Termin wurde gerade eben vergeben.');
  }
}

/** Aufbewahrung: zwölf Monate nach dem Termin, danach löscht der Cron die Daten. */
const AUFBEWAHRUNG_TAGE = 365;

export function basisUrl(anfrage?: URL | null) {
  if (anfrage) return anfrage.origin;
  return (env.SITE_URL || 'http://localhost:4321').replace(/\/$/, '');
}

export function ortText(ta: Pick<Terminart, 'ort_typ' | 'ort_wert'>, gastTelefon?: string | null) {
  switch (ta.ort_typ) {
    case 'google_meet':
      return 'Google Meet, der Link folgt in der Bestätigung';
    case 'telefon_wir':
      return gastTelefon ? `Telefon, wir rufen dich an unter ${gastTelefon}` : 'Telefon, wir rufen dich an';
    case 'telefon_gast':
      return ta.ort_wert ? `Telefon, ruf uns an unter ${ta.ort_wert}` : 'Telefon';
    case 'vor_ort':
      return ta.ort_wert || 'Vor Ort';
    case 'link':
      return ta.ort_wert ? `Videocall: ${ta.ort_wert}` : 'Videocall';
    default:
      return ORT_LABEL[ta.ort_typ as keyof typeof ORT_LABEL] ?? '';
  }
}

const terminDetails = terminDetailsVon;

function antwortenLesen(b: Buchung): { label: string; wert: string }[] {
  try {
    return JSON.parse(b.antworten || '[]');
  } catch {
    return [];
  }
}

function ics(b: Buchung, ta: Terminart, n: Nutzer, basis: string, storniert = false) {
  return icsDatei({
    uid: b.id,
    titel: `${ta.titel} mit ${n.name} (That's it. Marketing)`,
    beschreibung: [b.meeting_url ? `Meeting: ${b.meeting_url}` : '', `Termin verwalten: ${basis}/termin/${b.id}`].filter(Boolean).join('\n'),
    start: b.start_utc,
    ende: b.ende_utc,
    ort: b.meeting_url || b.ort_text,
    url: `${basis}/termin/${b.id}`,
    veranstalterName: n.name,
    veranstalterEmail: n.email,
    gastName: b.gast_name,
    gastEmail: b.gast_email,
    storniert,
  });
}

export async function webhookSenden(n: Nutzer, ereignis: string, nutzlast: Record<string, unknown>) {
  if (!n.webhook_url) return;
  const koerper = JSON.stringify({ ereignis, erstellt_am: jetztIso(), daten: nutzlast });
  const kopf: Record<string, string> = { 'content-type': 'application/json', 'user-agent': "Let's Meet Webhook" };
  if (n.webhook_secret) {
    const schluessel = await crypto.subtle.importKey('raw', new TextEncoder().encode(n.webhook_secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', schluessel, new TextEncoder().encode(koerper));
    kopf['x-letsmeet-signatur'] = Array.from(new Uint8Array(sig), (x) => x.toString(16).padStart(2, '0')).join('');
  }
  try {
    const res = await fetch(n.webhook_url, { method: 'POST', headers: kopf, body: koerper });
    if (!res.ok) console.error('Webhook antwortet mit', res.status);
  } catch (fehler) {
    console.error('Webhook fehlgeschlagen', fehler);
  }
}

export function webhookDaten(b: Buchung, ta: Terminart, n: Nutzer, basis: string) {
  return {
    buchung_id: b.id,
    status: b.status,
    terminart: { id: ta.id, titel: ta.titel, slug: ta.slug, dauer_min: ta.dauer_min },
    gastgeber: { name: n.name, email: n.email },
    gast: { name: b.gast_name, email: b.gast_email, telefon: b.gast_telefon, zeitzone: b.gast_zeitzone },
    start_utc: b.start_utc,
    ende_utc: b.ende_utc,
    ort: b.ort_text,
    meeting_url: b.meeting_url,
    antworten: antwortenLesen(b),
    nachricht: b.nachricht,
    storno_grund: b.storno_grund,
    umgebucht_von: b.umgebucht_von,
    verwalten_url: `${basis}/termin/${b.id}`,
    quelle: b.quelle,
  };
}

export async function buchungAnlegen(e: {
  terminart: Terminart;
  nutzer: Nutzer;
  startUtc: string;
  gastName: string;
  gastEmail: string;
  gastTelefon: string | null;
  gastZeitzone: string;
  antworten: { label: string; wert: string }[];
  nachricht: string | null;
  quelle: string | null;
  umbuchenVon: Buchung | null;
  basis: string;
  imHintergrund: (p: Promise<unknown>) => void;
}) {
  const { terminart: ta, nutzer: n } = e;
  const id = neueId();
  const start = new Date(e.startUtc);
  const ende = new Date(start.getTime() + ta.dauer_min * 60_000);
  const jetzt = jetztIso();
  const loeschenAb = new Date(ende.getTime() + AUFBEWAHRUNG_TAGE * 86_400_000).toISOString();
  const ort = ortText(ta, e.gastTelefon);

  await ausfuehren(
    `INSERT INTO buchungen (id, terminart_id, nutzer_id, start_utc, ende_utc, gast_name, gast_email, gast_telefon, gast_zeitzone,
      antworten, nachricht, status, umgebucht_von, ort_text, meeting_url, quelle, loeschen_ab, erstellt_am, aktualisiert_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bestaetigt', ?, ?, ?, ?, ?, ?, ?)`,
    id, ta.id, n.id, start.toISOString(), ende.toISOString(), e.gastName, e.gastEmail, e.gastTelefon, e.gastZeitzone,
    JSON.stringify(e.antworten), e.nachricht, e.umbuchenVon?.id ?? null, ort,
    ta.ort_typ === 'link' ? ta.ort_wert : null, e.quelle, loeschenAb, jetzt, jetzt,
  );

  // Schutz gegen Doppelbuchung bei gleichzeitigen Anfragen: D1 schreibt seriell,
  // die zuerst gespeicherte Buchung (kleinere rowid) gewinnt.
  const frueher = await eins<{ n: number }>(
    `SELECT COUNT(*) AS n FROM buchungen
     WHERE nutzer_id = ? AND status = 'bestaetigt' AND id != ? AND id != ?
       AND start_utc < ? AND ende_utc > ?
       AND rowid < (SELECT rowid FROM buchungen WHERE id = ?)`,
    n.id, id, e.umbuchenVon?.id ?? '', ende.toISOString(), start.toISOString(), id,
  );
  if (frueher && frueher.n > 0) {
    await ausfuehren('DELETE FROM buchungen WHERE id = ?', id);
    throw new SlotVergeben();
  }

  // Gast ins Kontaktbuch, ein Fehler dort darf die Buchung nicht verhindern
  await kontaktAusBuchung(n.id, e.gastName, e.gastEmail, e.gastTelefon).catch((f) => console.error('Kontakt nicht gespeichert', f));

  // Alte Buchung beim Umbuchen still beenden, Google Termin der alten Buchung entfernen
  if (e.umbuchenVon) {
    await ausfuehren(
      `UPDATE buchungen SET status = 'storniert', storno_grund = 'Umgebucht', storniert_von = 'gast', storniert_am = ?, umgebucht_zu = ?, aktualisiert_am = ? WHERE id = ?`,
      jetzt, id, jetzt, e.umbuchenVon.id,
    );
    if (e.umbuchenVon.google_event_id) await googleTerminLoeschen(n, e.umbuchenVon.google_event_id);
  }

  // Google Termin, bei Google Meet inklusive Meetinglink
  const beschreibung = [
    `Gebucht über Let's Meet von ${e.gastName} (${e.gastEmail})`,
    e.gastTelefon ? `Telefon: ${e.gastTelefon}` : '',
    ...e.antworten.map((a) => `${a.label}: ${a.wert}`),
    e.nachricht ? `Nachricht: ${e.nachricht}` : '',
    `Verwalten: ${e.basis}/app/termine/${id}`,
  ].filter(Boolean).join('\n');
  const google = await googleTerminAnlegen(n, {
    titel: `${ta.titel}: ${e.gastName}`,
    beschreibung,
    start: start.toISOString(),
    ende: ende.toISOString(),
    gastEmail: e.gastEmail,
    gastName: e.gastName,
    ort: ta.ort_typ === 'google_meet' ? null : ort,
    mitMeet: ta.ort_typ === 'google_meet',
    buchungId: id,
  }).catch((f) => {
    console.error(f);
    return null;
  });
  if (google) {
    await ausfuehren(
      'UPDATE buchungen SET google_event_id = ?, meeting_url = COALESCE(?, meeting_url), ort_text = CASE WHEN ? IS NOT NULL THEN ? ELSE ort_text END WHERE id = ?',
      google.id, google.meetUrl, google.meetUrl, 'Google Meet', id,
    );
  } else if (ta.ort_typ === 'google_meet') {
    await ausfuehren("UPDATE buchungen SET ort_text = 'Google Meet, den Link schicken wir dir separat' WHERE id = ?", id);
  }

  const buchung = (await eins<Buchung>('SELECT * FROM buchungen WHERE id = ?', id))!;
  e.imHintergrund(benachrichtigenNeu(buchung, ta, n, e.basis, Boolean(e.umbuchenVon)));
  return buchung;
}

async function benachrichtigenNeu(b: Buchung, ta: Terminart, n: Nutzer, basis: string, umgebucht: boolean) {
  const anhang = { filename: 'termin.ics', content: base64Utf8(ics(b, ta, n, basis)), content_type: 'text/calendar; method=REQUEST' };
  const aufgaben = [
    mailSenden({
      an: b.gast_email,
      antwortAn: n.email,
      betreff: `${umgebucht ? 'Umgebucht' : 'Bestätigt'}: ${ta.titel} am ${formatDatumLang(b.start_utc, b.gast_zeitzone)}`,
      html: mailGastBestaetigung(basis, {
        ...terminDetails(b, ta, n, b.gast_zeitzone),
        gastName: b.gast_name,
        verwaltenUrl: `${basis}/termin/${b.id}`,
        umgebucht,
        zusatz: ta.bestaetigung_text,
      }),
      anhaenge: [anhang],
    }),
    mailSenden({
      an: n.email,
      antwortAn: b.gast_email,
      betreff: `${umgebucht ? 'Umgebucht' : 'Neuer Termin'}: ${b.gast_name}, ${ta.titel} am ${formatDatumLang(b.start_utc, n.zeitzone)}`,
      html: mailGastgeberNeu(basis, {
        ...terminDetails(b, ta, n, n.zeitzone),
        gastName: b.gast_name,
        gastEmail: b.gast_email,
        gastTelefon: b.gast_telefon,
        antworten: antwortenLesen(b),
        nachricht: b.nachricht,
        backofficeUrl: `${basis}/app/termine/${b.id}`,
        herkunft: herkunft(b.quelle)?.text ?? null,
        umgebucht,
      }),
      anhaenge: [anhang],
    }),
    webhookSenden(n, umgebucht ? 'buchung.umgebucht' : 'buchung.erstellt', webhookDaten(b, ta, n, basis)),
    ablaeufeAusloesen('nach_buchung', b, ta, n, basis),
  ];
  const ergebnisse = await Promise.allSettled(aufgaben);
  ergebnisse.forEach((r) => r.status === 'rejected' && console.error('Benachrichtigung fehlgeschlagen', r.reason));
}

export async function buchungAbsagen(e: {
  buchung: Buchung;
  grund: string | null;
  von: 'gast' | 'gastgeber';
  basis: string;
  imHintergrund: (p: Promise<unknown>) => void;
}) {
  const b = e.buchung;
  const jetzt = jetztIso();
  await ausfuehren(
    `UPDATE buchungen SET status = 'storniert', storno_grund = ?, storniert_von = ?, storniert_am = ?, aktualisiert_am = ? WHERE id = ? AND status = 'bestaetigt'`,
    e.grund, e.von, jetzt, jetzt, b.id,
  );
  const ta = await eins<Terminart>('SELECT * FROM terminarten WHERE id = ?', b.terminart_id);
  const n = await eins<Nutzer>('SELECT * FROM nutzer WHERE id = ?', b.nutzer_id);
  if (!ta || !n) return;
  if (b.google_event_id) await googleTerminLoeschen(n, b.google_event_id);
  const aktuell = { ...b, status: 'storniert' as const, storno_grund: e.grund };
  const anhang = { filename: 'absage.ics', content: base64Utf8(ics(aktuell, ta, n, e.basis, true)), content_type: 'text/calendar; method=CANCEL' };
  const vonGast = e.von === 'gast';
  e.imHintergrund(
    Promise.allSettled([
      mailSenden({
        an: b.gast_email,
        antwortAn: n.email,
        betreff: `Abgesagt: ${ta.titel} am ${formatDatumLang(b.start_utc, b.gast_zeitzone)}`,
        html: mailStorno(e.basis, {
          ...terminDetails(aktuell, ta, n, b.gast_zeitzone),
          anName: b.gast_name,
          grund: e.grund,
          vonGast,
          anGast: true,
          neuBuchenUrl: `${e.basis}/${ta.slug}`,
        }),
        anhaenge: [anhang],
      }),
      mailSenden({
        an: n.email,
        antwortAn: b.gast_email,
        betreff: `Abgesagt: ${b.gast_name}, ${ta.titel} am ${formatDatumLang(b.start_utc, n.zeitzone)}`,
        html: mailStorno(e.basis, {
          ...terminDetails(aktuell, ta, n, n.zeitzone),
          gastgeber: b.gast_name,
          anName: n.name,
          grund: e.grund,
          vonGast,
          anGast: false,
        }),
        anhaenge: [anhang],
      }),
      webhookSenden(n, 'buchung.storniert', webhookDaten(aktuell, ta, n, e.basis)),
      ablaeufeAusloesen('bei_absage', aktuell, ta, n, e.basis),
    ]),
  );
}

/** Arbeitsabläufe (Erinnerungen und andere zeitversetzte Mails), abgelaufene Daten löschen und den Google Kalender abgleichen. Läuft per Cron alle zehn Minuten. */
export async function cronLauf() {
  const basis = basisUrl();
  const jetzt = Date.now();
  const ablaeufe = await ablaeufeImCron(basis).catch((fehler) => {
    console.error('Arbeitsabläufe im Cron fehlgeschlagen', fehler);
    return null;
  });
  await ausfuehren('DELETE FROM arbeitsablauf_versand WHERE buchung_id IN (SELECT id FROM buchungen WHERE loeschen_ab < ?)', new Date(jetzt).toISOString());
  const geloescht = await ausfuehren('DELETE FROM buchungen WHERE loeschen_ab < ?', new Date(jetzt).toISOString());
  const playbookZugaenge = await playbookZugaengeAufraeumen().catch((fehler) => {
    console.error('Playbook Zugänge aufräumen fehlgeschlagen', fehler);
    return 0;
  });
  const google = await googleAbgleichBuero().catch((fehler) => {
    console.error('Google Abgleich im Cron fehlgeschlagen', fehler);
    return null;
  });
  return { arbeitsablaeufe: ablaeufe, geloescht: geloescht.meta?.changes ?? 0, playbookZugaenge, googleTermine: google };
}
