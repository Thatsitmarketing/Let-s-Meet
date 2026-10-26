import { alle, eins } from './db';
import type { Buchung, Frage, Nutzer, Terminart } from './typen';

export const nutzerNachSlug = (slug: string) =>
  eins<Nutzer>('SELECT * FROM nutzer WHERE slug = ? AND aktiv = 1', slug.toLowerCase());

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

export function initialen(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((t) => t[0]!.toUpperCase())
    .join('');
}
