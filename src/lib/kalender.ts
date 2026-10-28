/**
 * Daten für den Backoffice Kalender: Verfügbarkeit, Termine und Google Belegtzeiten je Tag.
 * Alle Minutenangaben beziehen sich auf die Zone des angemeldeten Nutzers.
 */
import { alle } from './db';
import { GOOGLE_PUFFER_MIN, googleBelegt } from './google';
import type { Ausnahme, Nutzer, Regel } from './typen';
import { addTage, datumInZone, teileInZone, wochentagVon, zoneZuUtc } from './zeit';

export type KalAnsicht = 'woche' | 'monat';

export interface KalSpanne {
  start: number;
  ende: number;
}

export interface KalTermin extends KalSpanne {
  id: string;
  titel: string;
  farbe: string;
  gast: string;
  gastgeber: string;
  zeit: string;
  vergangen: boolean;
  nichtErschienen: boolean;
  spalte: number;
  spalten: number;
}

export interface KalTag {
  datum: string;
  wochentag: number;
  heute: boolean;
  vergangen: boolean;
  imMonat: boolean;
  /** keine: Wochenzeiten gelten, frei: ganzer Tag gesperrt, zeiten: abweichende Zeiten */
  ausnahme: 'keine' | 'frei' | 'zeiten';
  verfuegbar: KalSpanne[];
  termine: KalTermin[];
  belegt: KalSpanne[];
}

export interface KalDaten {
  ansicht: KalAnsicht;
  anker: string;
  tz: string;
  tage: KalTag[];
  titel: string;
  zurueck: string;
  weiter: string;
  heute: string;
  /** Sichtbarer Stundenbereich der Wochenansicht in Minuten */
  vonMin: number;
  bisMin: number;
  jetztMin: number | null;
  google: boolean;
  team: boolean;
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const zweistellig = (n: number) => String(n).padStart(2, '0');
const hhmm = (min: number) => `${zweistellig(Math.floor(min / 60))}:${zweistellig(min % 60)}`;

/** Kalenderwoche nach ISO 8601 */
export function kalenderwoche(datum: string) {
  const [j, m, t] = datum.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1, t));
  const tag = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - tag);
  const jahresanfang = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - jahresanfang) / 86_400_000 + 1) / 7);
}

function montagVon(datum: string) {
  return addTage(datum, -((wochentagVon(datum) + 6) % 7));
}

/** Liest Ansicht und Ankerdatum aus der URL. */
export function kalenderParameter(url: URL, tz: string) {
  const p = url.searchParams;
  const ansicht: KalAnsicht = p.get('kal') === 'monat' ? 'monat' : 'woche';
  const roh = p.get('datum') ?? '';
  const anker = /^\d{4}-\d{2}-\d{2}$/.test(roh) && !Number.isNaN(Date.parse(roh)) ? roh : datumInZone(new Date(), tz);
  return { ansicht, anker };
}

function bereich(ansicht: KalAnsicht, anker: string) {
  if (ansicht === 'woche') {
    const von = montagVon(anker);
    const bis = addTage(von, 6);
    const [, mv, tv] = von.split('-').map(Number);
    const [jb, mb, tb] = bis.split('-').map(Number);
    const titel = mv === mb ? `${tv}. bis ${tb}. ${MONATE[mb - 1]} ${jb}` : `${tv}. ${MONATE[mv - 1]} bis ${tb}. ${MONATE[mb - 1]} ${jb}`;
    return { von, tage: 7, titel: `KW ${kalenderwoche(von)}, ${titel}`, zurueck: addTage(anker, -7), weiter: addTage(anker, 7), monat: 0 };
  }
  const [j, m] = anker.split('-').map(Number);
  const erster = `${j}-${zweistellig(m)}-01`;
  const letzter = addTage(m === 12 ? `${j + 1}-01-01` : `${j}-${zweistellig(m + 1)}-01`, -1);
  const von = montagVon(erster);
  const bisSonntag = addTage(montagVon(letzter), 6);
  const tage = Math.round((Date.parse(bisSonntag) - Date.parse(von)) / 86_400_000) + 1;
  const zurueck = m === 1 ? `${j - 1}-12-01` : `${j}-${zweistellig(m - 1)}-01`;
  const weiter = m === 12 ? `${j + 1}-01-01` : `${j}-${zweistellig(m + 1)}-01`;
  return { von, tage, titel: `${MONATE[m - 1]} ${j}`, zurueck, weiter, monat: m };
}

/** Minuten ab Mitternacht eines Zeitpunkts innerhalb eines Tages, begrenzt auf 0 bis 1440. */
function minutenImTag(zeit: number, tagStart: number, tagEnde: number, tz: string) {
  if (zeit <= tagStart) return 0;
  if (zeit >= tagEnde) return 1440;
  const t = teileInZone(new Date(zeit), tz);
  return t.stunde * 60 + t.minute;
}

/** Zieht belegte Spannen von einer Liste ab, damit eigene Buchungen nicht doppelt als Google Termin erscheinen. */
function abziehen(spannen: { start: number; ende: number }[], weg: { start: number; ende: number }[]) {
  let rest = spannen;
  for (const w of weg) {
    rest = rest.flatMap((s) => {
      if (w.ende <= s.start || w.start >= s.ende) return [s];
      const teile = [];
      if (w.start > s.start) teile.push({ start: s.start, ende: w.start });
      if (w.ende < s.ende) teile.push({ start: w.ende, ende: s.ende });
      return teile;
    });
  }
  return rest.filter((s) => s.ende - s.start >= 60_000);
}

/** Verteilt überlappende Termine nebeneinander. */
function spaltenVerteilen(termine: KalTermin[]) {
  termine.sort((a, b) => a.start - b.start || b.ende - a.ende);
  let gruppe: KalTermin[] = [];
  let gruppenEnde = -1;
  const abschliessen = () => {
    const n = Math.max(1, ...gruppe.map((t) => t.spalte + 1));
    for (const t of gruppe) t.spalten = n;
    gruppe = [];
  };
  for (const t of termine) {
    if (t.start >= gruppenEnde && gruppe.length) abschliessen();
    const belegteSpalten = new Set(gruppe.filter((g) => g.ende > t.start).map((g) => g.spalte));
    let s = 0;
    while (belegteSpalten.has(s)) s++;
    t.spalte = s;
    gruppe.push(t);
    gruppenEnde = Math.max(gruppenEnde, t.ende);
  }
  if (gruppe.length) abschliessen();
}

interface Optionen {
  nutzer: Nutzer;
  ansicht: KalAnsicht;
  anker: string;
  /** Admins sehen auf Wunsch die Termine des ganzen Teams */
  team?: boolean;
}

export async function kalenderLaden({ nutzer, ansicht, anker, team = false }: Optionen): Promise<KalDaten> {
  const tz = nutzer.zeitzone;
  const b = bereich(ansicht, anker);
  const letzterTag = addTage(b.von, b.tage - 1);
  const vonUtc = zoneZuUtc(b.von, 0, tz);
  const bisUtc = zoneZuUtc(addTage(letzterTag, 1), 0, tz);
  const jetzt = new Date();
  const heute = datumInZone(jetzt, tz);

  const [regeln, ausnahmen, buchungen] = await Promise.all([
    alle<Regel>('SELECT wochentag, start_min, ende_min FROM verfuegbarkeit WHERE nutzer_id = ? ORDER BY start_min', nutzer.id),
    alle<Ausnahme>('SELECT id, datum, start_min, ende_min FROM ausnahmen WHERE nutzer_id = ? AND datum BETWEEN ? AND ? ORDER BY start_min', nutzer.id, b.von, letzterTag),
    alle<{ id: string; nutzer_id: string; start_utc: string; ende_utc: string; gast_name: string; nicht_erschienen: number; titel: string; farbe: string; gastgeber: string }>(
      `SELECT b.id, b.nutzer_id, b.start_utc, b.ende_utc, b.gast_name, b.nicht_erschienen, t.titel, t.farbe, n.name AS gastgeber
       FROM buchungen b JOIN terminarten t ON t.id = b.terminart_id JOIN nutzer n ON n.id = b.nutzer_id
       WHERE b.status = 'bestaetigt' AND b.start_utc < ? AND b.ende_utc > ? ${team ? '' : 'AND b.nutzer_id = ?'}
       ORDER BY b.start_utc`,
      ...(team ? [bisUtc.toISOString(), vonUtc.toISOString()] : [bisUtc.toISOString(), vonUtc.toISOString(), nutzer.id]),
    ),
  ]);

  const google = Boolean(nutzer.google_refresh_token) && !team;
  // Eigene Buchungen stehen als Google Termin samt Puffer im Kalender, der Puffer wird hier mit abgezogen
  const puffer = GOOGLE_PUFFER_MIN * 60_000;
  const eigene = buchungen.filter((x) => x.nutzer_id === nutzer.id).map((x) => ({ start: Date.parse(x.start_utc) - puffer, ende: Date.parse(x.ende_utc) + puffer }));
  const fremdBelegt = google ? abziehen(await googleBelegt(nutzer, vonUtc, bisUtc), eigene) : [];

  const ausnahmenNachTag = new Map<string, Ausnahme[]>();
  for (const a of ausnahmen) ausnahmenNachTag.set(a.datum, [...(ausnahmenNachTag.get(a.datum) ?? []), a]);

  const tage: KalTag[] = [];
  for (let i = 0; i < b.tage; i++) {
    const datum = addTage(b.von, i);
    const wochentag = wochentagVon(datum);
    const tagStart = zoneZuUtc(datum, 0, tz).getTime();
    const tagEnde = zoneZuUtc(addTage(datum, 1), 0, tz).getTime();
    const abweichung = ausnahmenNachTag.get(datum);
    const verfuegbar = abweichung
      ? abweichung.filter((a) => a.start_min !== null && a.ende_min !== null).map((a) => ({ start: a.start_min!, ende: a.ende_min! }))
      : regeln.filter((r) => r.wochentag === wochentag).map((r) => ({ start: r.start_min, ende: r.ende_min }));

    const termine: KalTermin[] = buchungen
      .filter((x) => Date.parse(x.start_utc) < tagEnde && Date.parse(x.ende_utc) > tagStart && (Date.parse(x.start_utc) >= tagStart || i === 0))
      .map((x) => {
        const s = Date.parse(x.start_utc);
        const e = Date.parse(x.ende_utc);
        const start = minutenImTag(s, tagStart, tagEnde, tz);
        const ende = Math.min(1440, Math.max(start + 15, minutenImTag(e, tagStart, tagEnde, tz)));
        return {
          id: x.id,
          start,
          ende,
          titel: x.titel,
          farbe: x.farbe,
          gast: x.gast_name,
          gastgeber: x.gastgeber,
          zeit: `${hhmm(start)} bis ${hhmm(Math.min(ende, 1440))}`,
          vergangen: e < jetzt.getTime(),
          nichtErschienen: Boolean(x.nicht_erschienen),
          spalte: 0,
          spalten: 1,
        };
      });
    spaltenVerteilen(termine);

    const belegt = fremdBelegt
      .filter((x) => x.start < tagEnde && x.ende > tagStart)
      .map((x) => ({ start: minutenImTag(x.start, tagStart, tagEnde, tz), ende: minutenImTag(x.ende, tagStart, tagEnde, tz) }))
      .filter((x) => x.ende > x.start);

    tage.push({
      datum,
      wochentag,
      heute: datum === heute,
      vergangen: datum < heute,
      imMonat: ansicht === 'woche' || Number(datum.slice(5, 7)) === b.monat,
      ausnahme: !abweichung ? 'keine' : verfuegbar.length ? 'zeiten' : 'frei',
      verfuegbar,
      termine,
      belegt,
    });
  }

  // Stundenbereich: mindestens 8 bis 18 Uhr, erweitert um alles, was in der Woche sichtbar sein muss
  let vonMin = 8 * 60;
  let bisMin = 18 * 60;
  for (const t of tage) {
    for (const s of [...t.verfuegbar, ...t.termine, ...t.belegt]) {
      vonMin = Math.min(vonMin, Math.floor(s.start / 60) * 60);
      bisMin = Math.max(bisMin, Math.ceil(s.ende / 60) * 60);
    }
  }
  // Wochenregeln mit einbeziehen, damit die Live Vorschau beim Bearbeiten nicht abgeschnitten wird
  for (const r of regeln) {
    vonMin = Math.min(vonMin, Math.floor(r.start_min / 60) * 60);
    bisMin = Math.max(bisMin, Math.ceil(r.ende_min / 60) * 60);
  }
  vonMin = Math.max(0, vonMin);
  bisMin = Math.min(1440, bisMin);

  const teileJetzt = teileInZone(jetzt, tz);
  const jetztMin = tage.some((t) => t.heute) ? teileJetzt.stunde * 60 + teileJetzt.minute : null;

  return { ansicht, anker, tz, tage, titel: b.titel, zurueck: b.zurueck, weiter: b.weiter, heute, vonMin, bisMin, jetztMin, google, team };
}
