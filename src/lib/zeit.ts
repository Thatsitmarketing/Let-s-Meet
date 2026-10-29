/**
 * Zeitzonenrechnung ohne Bibliothek, nur mit Intl.
 * Regeln liegen als Minuten ab Mitternacht in der Zone des Gastgebers vor,
 * gespeichert wird alles in UTC.
 */

const formatCache = new Map<string, Intl.DateTimeFormat>();

function teileFormat(tz: string) {
  let f = formatCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatCache.set(tz, f);
  }
  return f;
}

const WOCHENTAGE_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function teileInZone(datum: Date, tz: string) {
  const teile: Record<string, string> = {};
  for (const t of teileFormat(tz).formatToParts(datum)) teile[t.type] = t.value;
  return {
    jahr: Number(teile.year),
    monat: Number(teile.month),
    tag: Number(teile.day),
    stunde: Number(teile.hour),
    minute: Number(teile.minute),
    sekunde: Number(teile.second),
    wochentag: WOCHENTAGE_EN.indexOf(teile.weekday),
  };
}

/** Versatz der Zone gegenüber UTC in Minuten zu einem Zeitpunkt. */
export function versatzMin(datum: Date, tz: string) {
  const t = teileInZone(datum, tz);
  const alsUtc = Date.UTC(t.jahr, t.monat - 1, t.tag, t.stunde, t.minute, t.sekunde);
  return Math.round((alsUtc - Math.floor(datum.getTime() / 1000) * 1000) / 60000);
}

/** Lokales Datum plus Minuten in einer Zone als UTC Zeitpunkt. */
export function zoneZuUtc(datum: string, minuten: number, tz: string): Date {
  const [j, m, t] = datum.split('-').map(Number);
  const schaetzung = Date.UTC(j, m - 1, t, 0, minuten);
  const v1 = versatzMin(new Date(schaetzung), tz);
  let ergebnis = schaetzung - v1 * 60000;
  const v2 = versatzMin(new Date(ergebnis), tz);
  if (v2 !== v1) ergebnis = schaetzung - v2 * 60000;
  return new Date(ergebnis);
}

export function datumInZone(datum: Date, tz: string) {
  const t = teileInZone(datum, tz);
  return `${t.jahr}-${String(t.monat).padStart(2, '0')}-${String(t.tag).padStart(2, '0')}`;
}

export function addTage(datum: string, tage: number) {
  const [j, m, t] = datum.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1, t + tage));
  return d.toISOString().slice(0, 10);
}

export function wochentagVon(datum: string) {
  const [j, m, t] = datum.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, t)).getUTCDay();
}

export function minZuZeit(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function zeitZuMin(zeit: string) {
  const treffer = /^(\d{1,2}):(\d{2})$/.exec(zeit.trim());
  if (!treffer) return NaN;
  const h = Number(treffer[1]);
  const m = Number(treffer[2]);
  if (h > 24 || m > 59 || (h === 24 && m > 0)) return NaN;
  return h * 60 + m;
}

export function gueltigeZone(tz: string | null | undefined) {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function formatDatumLang(datum: Date | string, tz: string) {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(datum));
}

export function formatDatumKurz(datum: Date | string, tz: string) {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: tz,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(datum));
}

/** Kurz und lesbar wie „9. Okt. 2026“ */
export function formatDatumMittel(datum: Date | string, tz: string) {
  return new Intl.DateTimeFormat('de-DE', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(datum));
}

export function formatZeit(datum: Date | string, tz: string) {
  return new Intl.DateTimeFormat('de-DE', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(datum));
}

export function formatSpanne(start: string, ende: string, tz: string) {
  return `${formatZeit(start, tz)} bis ${formatZeit(ende, tz)} Uhr`;
}

export function zonenName(tz: string) {
  try {
    const teil = new Intl.DateTimeFormat('de-DE', { timeZone: tz, timeZoneName: 'long' })
      .formatToParts(new Date())
      .find((t) => t.type === 'timeZoneName');
    return teil ? `${teil.value} (${tz.replace(/_/g, ' ')})` : tz;
  } catch {
    return tz;
  }
}

export const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
