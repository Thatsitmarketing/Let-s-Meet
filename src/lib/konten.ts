import { passwortHash } from './auth';
import { ausfuehren, db, eins, jetztIso, neueId } from './db';
import { RESERVIERTE_SLUGS, slugify } from './eingabe';

/** Legt ein Teammitglied mit Standardverfügbarkeit (Mo bis Fr, 9 bis 17 Uhr) und einem Erstgespräch an. */
export async function kontoAnlegen(d: { name: string; email: string; slug: string; passwort: string; rolle: 'admin' | 'mitglied'; zeitzone?: string }) {
  const id = neueId();
  const jetzt = jetztIso();
  await ausfuehren(
    `INSERT INTO nutzer (id, email, name, slug, passwort_hash, rolle, zeitzone, erstellt_am, aktualisiert_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, d.email.toLowerCase(), d.name, d.slug, await passwortHash(d.passwort), d.rolle, d.zeitzone || 'Europe/Berlin', jetzt, jetzt,
  );
  const regeln = [1, 2, 3, 4, 5].map((tag) =>
    db().prepare('INSERT INTO verfuegbarkeit (nutzer_id, wochentag, start_min, ende_min) VALUES (?, ?, ?, ?)').bind(id, tag, 9 * 60, 17 * 60),
  );
  await db().batch([
    ...regeln,
    db()
      .prepare(
        `INSERT INTO terminarten (id, nutzer_id, slug, titel, dauer_min, farbe, ort_typ, raster_min, erstellt_am, aktualisiert_am)
         VALUES (?, ?, 'erstgespraech', 'Erstgespräch', 30, '#DC9832', 'google_meet', 30, ?, ?)`,
      )
      .bind(neueId(), id, jetzt, jetzt),
  ]);
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
