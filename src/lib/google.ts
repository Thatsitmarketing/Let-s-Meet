/**
 * Google Kalender: OAuth, Belegtzeiten, Abgleich der Termine in die Datenbank und Termine mit Google Meet Link.
 * Alles über fetch, ohne SDK. Ohne GOOGLE_CLIENT_ID bleibt die Integration aus.
 */
import { env } from 'cloudflare:workers';
import { alle, ausfuehren, db, eins } from './db';
import type { Nutzer } from './typen';
import { zoneZuUtc } from './zeit';

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
].join(' ');

// Beim Einfügen in Cloudflare rutschen leicht Leerzeichen oder Zeilenumbrüche mit
const clientId = () => (env.GOOGLE_CLIENT_ID ?? '').trim();
const clientSecret = () => (env.GOOGLE_CLIENT_SECRET ?? '').trim();

export function googleAktiv() {
  return Boolean(clientId() && clientSecret());
}

/** Fehler beim Tausch des Codes, code ist der Fehlercode von Google (etwa invalid_client) */
export class GoogleTokenFehler extends Error {
  constructor(public code: string, nachricht: string) {
    super(nachricht);
  }
}

/**
 * Übersetzt eine Fehlerantwort der Google Calendar API in einen verständlichen Grund.
 * Google liefert bei 403 sehr verschiedene Ursachen, der Statuscode allein hilft nicht weiter.
 */
export function googleApiFehler(status: number, text: string) {
  let gruende: string[] = [];
  let nachricht = '';
  try {
    const f = (JSON.parse(text) as { error?: { message?: string; status?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] } }).error;
    nachricht = f?.message ?? '';
    gruende = [f?.status, ...(f?.errors ?? []).map((e) => e.reason), ...(f?.details ?? []).map((d) => d.reason)].filter((g): g is string => Boolean(g));
  } catch {
    nachricht = text.slice(0, 200);
  }
  const hat = (...namen: string[]) => namen.some((n) => gruende.includes(n));
  if (hat('accessNotConfigured', 'SERVICE_DISABLED')) {
    return 'Die Google Calendar API ist im Google Cloud Projekt nicht aktiviert. In der Cloud Console unter APIs und Dienste, Bibliothek „Google Calendar API“ öffnen und aktivieren, danach einige Minuten warten und neu abgleichen.';
  }
  if (hat('insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
    return 'Google hat keinen Zugriff auf den Kalender freigegeben (beim Verbinden fehlte das Häkchen für den Kalender). Verbindung trennen, neu verbinden und bei Google alle Häkchen setzen.';
  }
  if (hat('rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'RATE_LIMIT_EXCEEDED')) {
    return 'Google bremst gerade die Anfragen (Kontingent erreicht). Der nächste Abgleich versucht es automatisch erneut.';
  }
  if (status === 404 || hat('notFound')) {
    return 'Den Kalender gibt es unter dieser Kalender ID nicht oder das verbundene Konto hat keinen Zugriff. Kalender ID prüfen, „primary“ ist der Hauptkalender.';
  }
  if (status === 401) return 'Der Google Zugang ist abgelaufen oder wurde widerrufen. Bitte neu verbinden.';
  return `Google Kalender antwortet mit ${status}${nachricht ? `: ${nachricht.slice(0, 200)}` : ''}`;
}

export function googleAuthUrl(redirectUri: string, state: string) {
  const p = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function googleCodeTauschen(code: string, redirectUri: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    let code = 'token';
    try {
      code = String((JSON.parse(text) as { error?: string }).error ?? 'token').replace(/[^a-z_]/g, '') || 'token';
    } catch {
      code = 'token';
    }
    throw new GoogleTokenFehler(code, `Google Token ${res.status}: ${text}`);
  }
  const daten = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string; scope?: string };
  let email: string | null = null;
  if (daten.id_token) {
    try {
      const nutzlast = JSON.parse(atob(daten.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      email = nutzlast.email ?? null;
    } catch {
      email = null;
    }
  }
  return { ...daten, email };
}

let letzterTokenFehler: string | null = null;

async function zugriffstoken(nutzer: Nutzer): Promise<string | null> {
  if (!googleAktiv() || !nutzer.google_refresh_token) return null;
  if (nutzer.google_access_token && nutzer.google_token_ablauf && nutzer.google_token_ablauf > Date.now() + 60_000) {
    return nutzer.google_access_token;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: nutzer.google_refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Google Token Erneuerung fehlgeschlagen', res.status, text);
    letzterTokenFehler = text.includes('invalid_grant')
      ? 'Google hat den gespeicherten Zugang abgelehnt (abgelaufen oder widerrufen). Steht die App in der Cloud Console unter Zielgruppe auf „Testen“, läuft der Zugang nach 7 Tagen ab: Status auf „In Produktion“ stellen, dann Verbindung trennen und neu verbinden.'
      : text.includes('invalid_client')
        ? 'Google kennt GOOGLE_CLIENT_ID oder GOOGLE_CLIENT_SECRET nicht. Secrets in Cloudflare prüfen.'
        : `Google Token Erneuerung fehlgeschlagen (${res.status}).`;
    return null;
  }
  letzterTokenFehler = null;
  const daten = (await res.json()) as { access_token: string; expires_in: number };
  const ablauf = Date.now() + daten.expires_in * 1000;
  await ausfuehren(
    'UPDATE nutzer SET google_access_token = ?, google_token_ablauf = ? WHERE id = ?',
    daten.access_token,
    ablauf,
    nutzer.id,
  );
  nutzer.google_access_token = daten.access_token;
  nutzer.google_token_ablauf = ablauf;
  return daten.access_token;
}

/** Puffer vor und nach jedem Termin im Google Kalender */
export const GOOGLE_PUFFER_MIN = 30;

/** Termine mit diesen Wörtern im Titel blockieren nichts (Kleinschreibung, Teilwort reicht) */
const IGNORIEREN = ['briefkasten'];

/** Zeitraum, den der Abgleich in der Datenbank vorhält */
export const ABGLEICH_TAGE_ZURUECK = 14;
export const ABGLEICH_TAGE_VORAUS = 120;

interface GoogleEreignis {
  id?: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

/** Ein Termin aus dem Google Kalender, Zeiten in Millisekunden UTC */
export interface GoogleTermin {
  eventId: string;
  titel: string;
  start: number;
  ende: number;
  ganztaegig: boolean;
  /** Blockiert buchbare Zeiten (mit Puffer davor und danach) */
  blockiert: boolean;
  ort: string | null;
  link: string | null;
}

/** Macht aus einem Google Ereignis einen Termin für Kalender und Slots, null bei abgesagten oder kaputten Einträgen. */
function ereignisZuTermin(e: GoogleEreignis, tz: string): GoogleTermin | null {
  if (!e.id || e.status === 'cancelled') return null;
  const ganztaegig = !e.start?.dateTime;
  const start = ganztaegig ? (e.start?.date ? zoneZuUtc(e.start.date, 0, tz).getTime() : NaN) : Date.parse(e.start!.dateTime!);
  const ende = ganztaegig ? (e.end?.date ? zoneZuUtc(e.end.date, 0, tz).getTime() : NaN) : Date.parse(e.end?.dateTime ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(ende) || ende <= start) return null;
  const titel = (e.summary ?? '').trim().slice(0, 300) || '(Ohne Titel)';
  const abgelehnt = Boolean(e.attendees?.some((a) => a.self && a.responseStatus === 'declined'));
  const ignoriert = IGNORIEREN.some((w) => titel.toLowerCase().includes(w));
  return {
    eventId: e.id,
    titel,
    start,
    ende,
    ganztaegig,
    blockiert: !ganztaegig && !abgelehnt && !ignoriert && e.transparency !== 'transparent',
    ort: e.location?.trim().slice(0, 300) || null,
    link: e.htmlLink?.startsWith('https://') ? e.htmlLink : null,
  };
}

/**
 * Liest alle Termine im Zeitraum aus dem Google Kalender. Wirft bei Fehlern.
 * Nicht blockierend sind ganztägige Einträge, abgelehnte Termine, Einträge mit Status „Verfügbar“
 * und Titel aus IGNORIEREN. Abgesagte Termine fehlen ganz.
 */
async function googleTermineLaden(nutzer: Nutzer, vonUtc: Date, bisUtc: Date): Promise<GoogleTermin[]> {
  const token = await zugriffstoken(nutzer);
  if (!token) throw new Error(letzterTokenFehler ?? 'Kein gültiger Google Zugang, bitte unter Integrationen neu verbinden.');
  const kalender = encodeURIComponent(nutzer.google_kalender_id || 'primary');
  const termine: GoogleTermin[] = [];
  let seite: string | undefined;
  for (let i = 0; i < 20; i++) {
    const p = new URLSearchParams({
      timeMin: vonUtc.toISOString(),
      timeMax: bisUtc.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      fields: 'nextPageToken,items(id,status,summary,location,htmlLink,transparency,start,end,attendees(self,responseStatus))',
    });
    if (seite) p.set('pageToken', seite);
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${kalender}/events?${p}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('Google Kalender Fehler', res.status, text);
      throw new Error(googleApiFehler(res.status, text));
    }
    const daten = (await res.json()) as { items?: GoogleEreignis[]; nextPageToken?: string };
    for (const e of daten.items ?? []) {
      const t = ereignisZuTermin(e, nutzer.zeitzone);
      if (t) termine.push(t);
    }
    seite = daten.nextPageToken;
    if (!seite) break;
  }
  return termine;
}

const mitPuffer = (t: { start: number; ende: number }) => ({
  start: t.start - GOOGLE_PUFFER_MIN * 60_000,
  ende: t.ende + GOOGLE_PUFFER_MIN * 60_000,
});

/**
 * Belegte Zeiten aus dem Google Kalender: alle blockierenden Termine, je mit 30 Minuten Puffer davor und danach.
 * Live abgefragt, damit eine Buchung nie auf veralteten Daten beruht. Ist Google nicht erreichbar,
 * gilt der letzte Abgleich aus der Datenbank.
 */
export async function googleBelegt(nutzer: Nutzer, vonUtc: Date, bisUtc: Date): Promise<{ start: number; ende: number }[]> {
  if (!googleAktiv() || !nutzer.google_refresh_token) return [];
  const puffer = GOOGLE_PUFFER_MIN * 60_000;
  try {
    const termine = await googleTermineLaden(nutzer, new Date(vonUtc.getTime() - puffer), new Date(bisUtc.getTime() + puffer));
    return termine.filter((t) => t.blockiert).map(mitPuffer);
  } catch (fehler) {
    console.error('Google Belegtzeiten nicht abrufbar, nutze letzten Abgleich', fehler);
    const zeilen = await alle<{ start_utc: string; ende_utc: string }>(
      'SELECT start_utc, ende_utc FROM google_termine WHERE nutzer_id = ? AND blockiert = 1 AND start_utc < ? AND ende_utc > ?',
      nutzer.id,
      new Date(bisUtc.getTime() + puffer).toISOString(),
      new Date(vonUtc.getTime() - puffer).toISOString(),
    ).catch(() => []);
    return zeilen.map((z) => mitPuffer({ start: Date.parse(z.start_utc), ende: Date.parse(z.ende_utc) }));
  }
}

/**
 * Übernimmt die Termine des Google Kalenders in die Tabelle google_termine
 * (14 Tage zurück bis 120 Tage voraus). Läuft per Cron alle zehn Minuten und auf Knopfdruck.
 * Gibt die Anzahl der Termine zurück oder null bei einem Fehler (Grund steht in nutzer.google_abgleich_fehler).
 */
export async function googleAbgleich(nutzer: Nutzer): Promise<number | null> {
  if (!googleAktiv() || !nutzer.google_refresh_token) return null;
  const jetzt = Date.now();
  const von = new Date(jetzt - ABGLEICH_TAGE_ZURUECK * 86_400_000);
  const bis = new Date(jetzt + ABGLEICH_TAGE_VORAUS * 86_400_000);
  const stand = new Date(jetzt).toISOString();
  try {
    const termine = await googleTermineLaden(nutzer, von, bis);
    const d = db();
    const befehle = [
      // Alles im Abgleichzeitraum wird ersetzt, ältere Einträge nach 30 Tagen entfernt
      d.prepare('DELETE FROM google_termine WHERE nutzer_id = ? AND ((ende_utc > ? AND start_utc < ?) OR ende_utc < ?)')
        .bind(nutzer.id, von.toISOString(), bis.toISOString(), new Date(jetzt - 30 * 86_400_000).toISOString()),
    ];
    // D1 erlaubt höchstens 100 Parameter je Befehl, also 8 Zeilen mit je 10 Werten
    for (let i = 0; i < termine.length; i += 8) {
      const teil = termine.slice(i, i + 8);
      befehle.push(
        d.prepare(
          `INSERT OR REPLACE INTO google_termine (nutzer_id, event_id, titel, start_utc, ende_utc, ganztaegig, blockiert, ort, link, aktualisiert_am)
           VALUES ${teil.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        ).bind(
          ...teil.flatMap((t) => [
            nutzer.id, t.eventId, t.titel, new Date(t.start).toISOString(), new Date(t.ende).toISOString(),
            t.ganztaegig ? 1 : 0, t.blockiert ? 1 : 0, t.ort, t.link, stand,
          ]),
        ),
      );
    }
    befehle.push(d.prepare('UPDATE nutzer SET google_abgleich_am = ?, google_abgleich_fehler = NULL WHERE id = ?').bind(stand, nutzer.id));
    await d.batch(befehle);
    nutzer.google_abgleich_am = stand;
    nutzer.google_abgleich_fehler = null;
    return termine.length;
  } catch (fehler) {
    console.error('Google Abgleich fehlgeschlagen', fehler);
    const grund = (fehler instanceof Error ? fehler.message : String(fehler)).slice(0, 300);
    await ausfuehren('UPDATE nutzer SET google_abgleich_fehler = ? WHERE id = ?', grund, nutzer.id).catch(() => null);
    nutzer.google_abgleich_fehler = grund;
    return null;
  }
}

/** Gleicht den Google Kalender des Büros ab (für den Cron). */
export async function googleAbgleichBuero() {
  const buero = await eins<Nutzer>('SELECT * FROM nutzer WHERE ist_buero = 1 AND google_refresh_token IS NOT NULL LIMIT 1');
  return buero ? googleAbgleich(buero) : null;
}

/** Entfernt alle abgeglichenen Termine, etwa beim Trennen oder bei einem anderen Kalender. */
export async function googleTermineEntfernen(nutzerId: string) {
  await ausfuehren('DELETE FROM google_termine WHERE nutzer_id = ?', nutzerId);
  await ausfuehren('UPDATE nutzer SET google_abgleich_am = NULL, google_abgleich_fehler = NULL WHERE id = ?', nutzerId);
}

/** Vollständiger Google Termin für die Detailseite im Backoffice */
export interface GoogleDetail extends GoogleTermin {
  beschreibung: string;
  /** Beschreibung so, wie Google sie liefert (kann HTML enthalten) */
  beschreibungRoh: string;
  meetUrl: string | null;
  wiederkehrend: boolean;
  /** Nur der Organisator darf Titel und Zeiten ändern */
  bearbeitbar: boolean;
  organisator: string | null;
  frei: boolean;
  teilnehmer: { name: string; email: string; antwort: string; organisator: boolean }[];
}

interface GoogleEreignisVoll extends GoogleEreignis {
  description?: string;
  hangoutLink?: string;
  recurringEventId?: string;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: { self?: boolean; responseStatus?: string; email?: string; displayName?: string; organizer?: boolean }[];
}

/** Macht aus der HTML Beschreibung von Google lesbaren Text (Zeilenumbrüche bleiben, Links als Adresse). */
export function htmlZuText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_m, url: string, text: string) => (text && text !== url ? `${text} (${url})` : url))
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function einzelAnfrage(nutzer: Nutzer, eventId: string, methode: 'GET' | 'PATCH' | 'DELETE', abfrage = '', koerper?: unknown) {
  const token = await zugriffstoken(nutzer);
  if (!token) throw new Error(letzterTokenFehler ?? 'Kein gültiger Google Zugang, bitte unter Integrationen neu verbinden.');
  const kalender = encodeURIComponent(nutzer.google_kalender_id || 'primary');
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${kalender}/events/${encodeURIComponent(eventId)}${abfrage}`, {
    method: methode,
    headers: { authorization: `Bearer ${token}`, ...(koerper ? { 'content-type': 'application/json' } : {}) },
    body: koerper ? JSON.stringify(koerper) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Google Termin', methode, res.status, text);
    // Termin gibt es nicht mehr: beim Lesen null, beim Löschen ist das Ziel erreicht
    if (methode !== 'PATCH' && (res.status === 404 || res.status === 410)) return null;
    throw new Error(googleApiFehler(res.status, text));
  }
  return methode === 'DELETE' ? null : ((await res.json()) as GoogleEreignisVoll);
}

function zuDetail(e: GoogleEreignisVoll, tz: string): GoogleDetail | null {
  const t = ereignisZuTermin(e, tz);
  if (!t) return null;
  const roh = e.description ?? '';
  return {
    ...t,
    beschreibungRoh: roh,
    beschreibung: /<[a-z][\s\S]*>/i.test(roh) ? htmlZuText(roh) : roh.trim(),
    meetUrl: e.hangoutLink?.startsWith('https://') ? e.hangoutLink : null,
    wiederkehrend: Boolean(e.recurringEventId),
    // Ohne Angabe zum Organisator ist es ein eigener Termin
    bearbeitbar: e.organizer ? e.organizer.self === true : true,
    organisator: e.organizer?.self ? null : e.organizer?.displayName || e.organizer?.email || null,
    frei: e.transparency === 'transparent',
    teilnehmer: (e.attendees ?? []).map((a) => ({
      name: a.displayName ?? '',
      email: a.email ?? '',
      antwort: a.responseStatus ?? 'needsAction',
      organisator: Boolean(a.organizer),
    })),
  };
}

/** Speichert einen einzelnen Termin in google_termine, damit Kalender und Liste sofort stimmen. */
async function terminZeileSpeichern(nutzerId: string, t: GoogleTermin) {
  await ausfuehren(
    `INSERT OR REPLACE INTO google_termine (nutzer_id, event_id, titel, start_utc, ende_utc, ganztaegig, blockiert, ort, link, aktualisiert_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    nutzerId, t.eventId, t.titel, new Date(t.start).toISOString(), new Date(t.ende).toISOString(),
    t.ganztaegig ? 1 : 0, t.blockiert ? 1 : 0, t.ort, t.link, new Date().toISOString(),
  );
}

/** Liest einen Termin live aus Google. null, wenn es ihn nicht (mehr) gibt. Wirft bei anderen Fehlern. */
export async function googleTerminLesen(nutzer: Nutzer, eventId: string): Promise<GoogleDetail | null> {
  const e = await einzelAnfrage(nutzer, eventId, 'GET');
  const d = e ? zuDetail(e, nutzer.zeitzone) : null;
  // In Google gelöscht oder abgesagt: auch aus dem Kalender im Backoffice entfernen
  if (!d) await ausfuehren('DELETE FROM google_termine WHERE nutzer_id = ? AND event_id = ?', nutzer.id, eventId);
  else await terminZeileSpeichern(nutzer.id, d);
  return d;
}

export interface GoogleAenderung {
  titel: string;
  ort: string;
  /** null: Beschreibung bleibt unverändert */
  beschreibung: string | null;
  ganztaegig: boolean;
  /** ganztägig: Datum YYYY-MM-DD, sonst Zeitpunkt in ms */
  startDatum?: string;
  endeDatumExklusiv?: string;
  start?: number;
  ende?: number;
  frei: boolean;
}

/** Ändert einen Termin in Google und übernimmt das Ergebnis direkt in die D1. */
export async function googleTerminAendern(nutzer: Nutzer, eventId: string, a: GoogleAenderung, benachrichtigen: boolean) {
  const koerper: Record<string, unknown> = {
    summary: a.titel,
    location: a.ort,
    transparency: a.frei ? 'transparent' : 'opaque',
    // Die Art (ganztägig oder mit Uhrzeit) bleibt immer gleich, daher reicht das passende Feld
    start: a.ganztaegig ? { date: a.startDatum } : { dateTime: new Date(a.start!).toISOString(), timeZone: nutzer.zeitzone },
    end: a.ganztaegig ? { date: a.endeDatumExklusiv } : { dateTime: new Date(a.ende!).toISOString(), timeZone: nutzer.zeitzone },
  };
  if (a.beschreibung !== null) koerper.description = a.beschreibung;
  const e = await einzelAnfrage(nutzer, eventId, 'PATCH', `?sendUpdates=${benachrichtigen ? 'all' : 'none'}`, koerper);
  const t = e ? ereignisZuTermin(e, nutzer.zeitzone) : null;
  if (t) await terminZeileSpeichern(nutzer.id, t);
}

/** Löscht einen Termin in Google (bei Fremdterminen: entfernt ihn aus dem Kalender des Büros) und aus der D1. */
export async function googleTerminEntfernen(nutzer: Nutzer, eventId: string, benachrichtigen: boolean) {
  await einzelAnfrage(nutzer, eventId, 'DELETE', `?sendUpdates=${benachrichtigen ? 'all' : 'none'}`);
  await ausfuehren('DELETE FROM google_termine WHERE nutzer_id = ? AND event_id = ?', nutzer.id, eventId);
}

export async function googleTerminAnlegen(
  nutzer: Nutzer,
  termin: {
    titel: string;
    beschreibung: string;
    start: string;
    ende: string;
    gastEmail: string;
    gastName: string;
    ort?: string | null;
    mitMeet: boolean;
    buchungId: string;
  },
): Promise<{ id: string; meetUrl: string | null } | null> {
  const token = await zugriffstoken(nutzer);
  if (!token) return null;
  const koerper: Record<string, unknown> = {
    summary: termin.titel,
    description: termin.beschreibung,
    start: { dateTime: termin.start },
    end: { dateTime: termin.ende },
    attendees: [{ email: termin.gastEmail, displayName: termin.gastName }],
    location: termin.ort ?? undefined,
    reminders: { useDefault: true },
  };
  if (termin.mitMeet) {
    koerper.conferenceData = {
      createRequest: { requestId: termin.buchungId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    };
  }
  const kalender = encodeURIComponent(nutzer.google_kalender_id || 'primary');
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${kalender}/events?conferenceDataVersion=1&sendUpdates=none`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(koerper),
    },
  );
  if (!res.ok) {
    console.error('Google Termin nicht angelegt', res.status, await res.text());
    return null;
  }
  const daten = (await res.json()) as { id: string; hangoutLink?: string };
  return { id: daten.id, meetUrl: daten.hangoutLink ?? null };
}

export async function googleTerminLoeschen(nutzer: Nutzer, eventId: string) {
  const token = await zugriffstoken(nutzer);
  if (!token) return;
  const kalender = encodeURIComponent(nutzer.google_kalender_id || 'primary');
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${kalender}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    console.error('Google Termin nicht gelöscht', res.status, await res.text());
  }
}
