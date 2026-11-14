/**
 * Terminvorschläge für den WhatsApp Bot.
 * Normale Leads frühestens 7 Tage nach der Anfrage (so lange braucht der Entwurf),
 * heiße Leads ("So schnell es geht" und Budget passt) nach 3 bis 4 Werktagen.
 * Nie am Wochenende oder an einem Feiertag in NRW. Zwei Vorschläge an verschiedenen Tagen.
 */
import { env } from 'cloudflare:workers';
import { buero, terminartNachSlug } from '../abfragen';
import { freieSlots } from '../slots';
import type { Nutzer, Terminart } from '../typen';
import { addTage, datumInZone, teileInZone, wochentagVon, zoneZuUtc } from '../zeit';

const TAGE_NORMAL = 7;
const WERKTAGE_HEISS = 3;
/** So weit sucht der Bot nach dem frühesten Tag nach freien Zeiten. */
const SUCHFENSTER_TAGE = 12;

function ostersonntag(jahr: number) {
  // Gaußsche Osterformel (Anonymer Gregorianischer Algorithmus)
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
}

/** Gesetzliche Feiertage in Nordrhein-Westfalen als YYYY-MM-DD. */
export function feiertageNrw(jahr: number) {
  const ostern = ostersonntag(jahr);
  return new Set([
    `${jahr}-01-01`,
    addTage(ostern, -2), // Karfreitag
    addTage(ostern, 1), // Ostermontag
    `${jahr}-05-01`,
    addTage(ostern, 39), // Christi Himmelfahrt
    addTage(ostern, 50), // Pfingstmontag
    addTage(ostern, 60), // Fronleichnam
    `${jahr}-10-03`,
    `${jahr}-11-01`,
    `${jahr}-12-25`,
    `${jahr}-12-26`,
  ]);
}

export function istWerktag(datum: string) {
  const wt = wochentagVon(datum);
  if (wt === 0 || wt === 6) return false;
  return !feiertageNrw(Number(datum.slice(0, 4))).has(datum);
}

function naechsterWerktag(datum: string) {
  let d = datum;
  while (!istWerktag(d)) d = addTage(d, 1);
  return d;
}

/** Frühester Tag, an dem der Entwurf fertig ist und ein Termin angeboten wird. */
export function fruehesterTag(heiss: boolean, jetzt = new Date(), tz = 'Europe/Berlin') {
  const heute = datumInZone(jetzt, tz);
  if (!heiss) return naechsterWerktag(addTage(heute, TAGE_NORMAL));
  let d = heute;
  for (let n = 0; n < WERKTAGE_HEISS; ) {
    d = addTage(d, 1);
    if (istWerktag(d)) n++;
  }
  return d;
}

export async function botTerminart(): Promise<{ terminart: Terminart; nutzer: Nutzer } | null> {
  const nutzer = await buero();
  if (!nutzer) return null;
  const slug = (env.WHATSAPP_TERMINART || 'strategiegespraech-webseite').trim();
  const terminart = await terminartNachSlug(nutzer.id, slug);
  return terminart ? { terminart, nutzer } : null;
}

async function freiAb(ta: Terminart, n: Nutzer, abTag: string, tage = SUCHFENSTER_TAGE) {
  const von = zoneZuUtc(abTag, 0, n.zeitzone);
  const bis = zoneZuUtc(addTage(abTag, tage), 0, n.zeitzone);
  const slots = await freieSlots({ terminart: ta, nutzer: n, von, bis });
  return slots.filter((s) => istWerktag(datumInZone(new Date(s), n.zeitzone)));
}

const minutenAmTag = (iso: string, tz: string) => {
  const t = teileInZone(new Date(iso), tz);
  return t.stunde * 60 + t.minute;
};

/**
 * Zwei Vorschläge an verschiedenen Tagen: der erste freie Termin am frühesten Tag,
 * der zweite am nächsten Tag zu einer anderen Tageszeit, damit wirklich eine Wahl bleibt.
 */
export async function zweiVorschlaege(ta: Terminart, n: Nutzer, heiss: boolean, jetzt = new Date()) {
  const slots = await freiAb(ta, n, fruehesterTag(heiss, jetzt, n.zeitzone));
  if (!slots.length) return [];
  const erster = slots[0];
  const ersterTag = datumInZone(new Date(erster), n.zeitzone);
  const ersterVormittag = minutenAmTag(erster, n.zeitzone) < 12 * 60;
  const andereTage = slots.filter((s) => datumInZone(new Date(s), n.zeitzone) !== ersterTag);
  if (!andereTage.length) return [erster];
  const tag2 = datumInZone(new Date(andereTage[0]), n.zeitzone);
  const amTag2 = andereTage.filter((s) => datumInZone(new Date(s), n.zeitzone) === tag2);
  const zweiter = amTag2.find((s) => minutenAmTag(s, n.zeitzone) < 12 * 60 !== ersterVormittag) ?? amTag2[0];
  return [erster, zweiter];
}

/**
 * Freie Zeiten nahe am Wunsch des Leads. `datum` als YYYY-MM-DD, `uhrzeit` als HH:MM.
 * Liegt der Wunsch vor dem frühesten Tag, wird ab dem frühesten Tag gesucht.
 */
export async function vorschlaegeZumWunsch(
  ta: Terminart,
  n: Nutzer,
  heiss: boolean,
  wunsch: { datum: string | null; uhrzeit: string | null; tageszeit: 'vormittag' | 'nachmittag' | null },
  jetzt = new Date(),
) {
  const frueh = fruehesterTag(heiss, jetzt, n.zeitzone);
  const ab = wunsch.datum && wunsch.datum > frueh ? wunsch.datum : frueh;
  const slots = await freiAb(ta, n, ab, wunsch.datum ? 6 : SUCHFENSTER_TAGE);
  if (!slots.length) return { slots: [] as string[], zuFrueh: Boolean(wunsch.datum && wunsch.datum < frueh), frueh };

  const zielMin = wunsch.uhrzeit
    ? Number(wunsch.uhrzeit.slice(0, 2)) * 60 + Number(wunsch.uhrzeit.slice(3, 5))
    : wunsch.tageszeit === 'vormittag'
      ? 10 * 60
      : wunsch.tageszeit === 'nachmittag'
        ? 15 * 60
        : null;

  const ersterTag = datumInZone(new Date(slots[0]), n.zeitzone);
  const tagWunsch = wunsch.datum && slots.some((s) => datumInZone(new Date(s), n.zeitzone) === ab) ? ab : ersterTag;
  let auswahl = slots.filter((s) => datumInZone(new Date(s), n.zeitzone) === tagWunsch);
  if (zielMin !== null) auswahl = [...auswahl].sort((a, b) => Math.abs(minutenAmTag(a, n.zeitzone) - zielMin) - Math.abs(minutenAmTag(b, n.zeitzone) - zielMin));
  // Am Wunschtag höchstens zwei, dazu einen Ausweichtermin am nächsten Tag
  const ergebnis = auswahl.slice(0, 2).sort();
  const naechster = slots.find((s) => datumInZone(new Date(s), n.zeitzone) > tagWunsch);
  if (naechster && ergebnis.length < 3) ergebnis.push(naechster);
  return { slots: ergebnis, zuFrueh: Boolean(wunsch.datum && wunsch.datum < frueh), frueh };
}

/** "Di 18.11. 10:00", passt in einen Knopf (höchstens 20 Zeichen) */
export function slotKurz(iso: string, tz: string) {
  const d = new Date(iso);
  const tag = new Intl.DateTimeFormat('de-DE', { timeZone: tz, weekday: 'short' }).format(d).replace('.', '');
  const datum = new Intl.DateTimeFormat('de-DE', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(d);
  const zeit = new Intl.DateTimeFormat('de-DE', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(d);
  return `${tag} ${datum} ${zeit}`;
}

/** "Dienstag, 18. November um 10:00 Uhr" */
export function slotLang(iso: string, tz: string) {
  const d = new Date(iso);
  const tag = new Intl.DateTimeFormat('de-DE', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  const zeit = new Intl.DateTimeFormat('de-DE', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(d);
  return `${tag} um ${zeit} Uhr`;
}

/** "Dienstag, 18. November" für Hinweise wie "frühestens ab ..." */
export function tagLang(datum: string, tz: string) {
  return new Intl.DateTimeFormat('de-DE', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(zoneZuUtc(datum, 12 * 60, tz));
}
