import { passwortHash } from './auth';
import { ausfuehren, eins, jetztIso, neueId } from './db';
import { RESERVIERTE_SLUGS, slugify } from './eingabe';

/**
 * Legt ein Konto für das Backoffice an. Terminarten und Verfügbarkeit gehören dem Büro
 * (siehe migrations/0002_zentrales_buero.sql), darum bekommt ein neues Konto keine eigenen.
 */
export async function kontoAnlegen(d: { name: string; email: string; slug: string; passwort: string; rolle: 'admin' | 'mitglied'; zeitzone?: string }) {
  const id = neueId();
  const jetzt = jetztIso();
  await ausfuehren(
    `INSERT INTO nutzer (id, email, name, slug, passwort_hash, rolle, zeitzone, erstellt_am, aktualisiert_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, d.email.toLowerCase(), d.name, d.slug, await passwortHash(d.passwort), d.rolle, d.zeitzone || 'Europe/Berlin', jetzt, jetzt,
  );
  return id;
}

export async function slugPruefen(roh: string, ohneNutzer?: string) {
  const slug = slugify(roh);
  if (slug.length < 2) return { slug, fehler: 'Bitte mindestens zwei Zeichen.' };
  if (RESERVIERTE_SLUGS.has(slug)) return { slug, fehler: 'Diese Adresse ist reserviert.' };
  const vorhanden = await eins<{ id: string }>('SELECT id FROM nutzer WHERE slug = ?', slug);
  if (vorhanden && vorhanden.id !== ohneNutzer) return { slug, fehler: 'Diese Adresse ist schon vergeben.' };
  return { slug, fehler: null };
}
