import { alle, eins } from './db';
import type { Buchung, Frage, Nutzer, Terminart, Unterlage } from './typen';

export const nutzerNachSlug = (slug: string) =>
  eins<Nutzer>('SELECT * FROM nutzer WHERE slug = ? AND aktiv = 1', slug.toLowerCase());

/** Das zentrale Büro (info@thatsit.marketing). Alle öffentlichen Buchungen laufen darüber. */
export const buero = () =>
  eins<Nutzer>('SELECT * FROM nutzer WHERE ist_buero = 1 ORDER BY erstellt_am LIMIT 1');

/** Teammitglieder, die sich anmelden können (das Büro ohne Passwort zählt nicht). */
export const LOGIN_KONTO = "passwort_hash LIKE 'pbkdf2$%'";

export const nutzerNachId = (id: string) => eins<Nutzer>('SELECT * FROM nutzer WHERE id = ?', id);

export const aktiveNutzer = () =>
  alle<Nutzer>('SELECT * FROM nutzer WHERE aktiv = 1 ORDER BY rolle = \'admin\' DESC, name');

export const terminartenVon = (nutzerId: string, nurOeffentlich = false) =>
  alle<Terminart>(
    `SELECT * FROM terminarten WHERE nutzer_id = ? ${nurOeffentlich ? 'AND aktiv = 1 AND geheim = 0' : ''} ORDER BY reihenfolge, erstellt_am`,
    nutzerId,
  );

export const terminartNachSlug = (nutzerId: string, slug: string) =>
  eins<Terminart>('SELECT * FROM terminarten WHERE nutzer_id = ? AND slug = ?', nutzerId, slug.toLowerCase());

export const terminartNachId = (id: string) => eins<Terminart>('SELECT * FROM terminarten WHERE id = ?', id);

export const buchungNachId = (id: string) => eins<Buchung>('SELECT * FROM buchungen WHERE id = ?', id);

export function fragenLesen(ta: Pick<Terminart, 'fragen'>): Frage[] {
  try {
    const roh = JSON.parse(ta.fragen || '[]');
    return Array.isArray(roh) ? roh : [];
  } catch {
    return [];
  }
}

export function unterlagenLesen(ta: Pick<Terminart, 'unterlagen'>): Unterlage[] {
  try {
    const roh = JSON.parse(ta.unterlagen || '[]');
    return Array.isArray(roh) ? roh.filter((u) => u && u.titel && u.url) : [];
  } catch {
    return [];
  }
}

/** Erinnerungen einer Terminart in Minuten, größte zuerst. Ohne Spalte (alter Stand) gilt erinnerung_std. */
export function erinnerungenLesen(ta: Pick<Terminart, 'erinnerungen' | 'erinnerung_std'>): number[] {
  let roh: unknown = [];
  try {
    roh = JSON.parse(ta.erinnerungen ?? 'null') ?? (ta.erinnerung_std > 0 ? [ta.erinnerung_std * 60] : []);
  } catch {
    roh = [];
  }
  if (!Array.isArray(roh)) return [];
  const minuten = roh.map(Number).filter((m) => Number.isInteger(m) && m >= 10 && m <= 10080);
  return [...new Set(minuten)].sort((a, b) => b - a);
}

export function initialen(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((t) => t[0]!.toUpperCase())
    .join('');
}
