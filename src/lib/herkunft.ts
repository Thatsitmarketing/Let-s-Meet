/**
 * Woher kommt eine Buchung? Die Homepage und die Playbook-Landingpages geben im Fragment
 * der Adresse `quelle` mit (`website <seite>` bzw. `playbook <name>`), das Widget die
 * einbettende Seite. Hier wird daraus ein lesbarer Text für Formular, Mails und Backoffice.
 * Ohne Abhängigkeiten, damit es im Browser (buchung.ts) und auf dem Server läuft.
 */

const HOMEPAGE: Record<string, string> = {
  start: 'Homepage, Startseite',
  webdesign: 'Homepage, Leistungsseite Webdesign',
  social: 'Homepage, Leistungsseite Social Media',
  'fotos-videos': 'Homepage, Leistungsseite Fotos & Videos',
  recruiting: 'Homepage, Leistungsseite Recruiting',
  referenzen: 'Homepage, Referenzen',
};

/** Name des Playbooks, ohne "Landingpage" davor (für den Hinweis im Formular). */
export const PLAYBOOKS: Record<string, string> = {
  website: 'Website Conversion Playbook',
  social: 'Social Media Playbook',
  recruiting: 'Social Recruiting Playbook',
  gastro: 'Gastro Marketing Playbook',
};

export interface Herkunft {
  art: 'homepage' | 'playbook' | 'sonstige';
  /** lesbarer Text, z. B. "Landingpage Gastro Marketing Playbook" */
  text: string;
  /** nur bei Playbooks: Name des Playbooks */
  playbook?: string;
}

export function herkunft(quelle: string | null | undefined): Herkunft | null {
  const roh = (quelle ?? '').trim();
  if (!roh) return null;
  const [art, ...rest] = roh.split(/\s+/);
  const schluessel = rest.join(' ').toLowerCase();
  if (art === 'playbook') {
    const name = PLAYBOOKS[schluessel];
    return name ? { art: 'playbook', text: `Landingpage ${name}`, playbook: name } : { art: 'playbook', text: roh };
  }
  if (art === 'backoffice') return { art: 'sonstige', text: 'Backoffice, gebucht aus dem Kontaktbuch' };
  if (art === 'website') return { art: 'homepage', text: HOMEPAGE[schluessel] ?? `Homepage, ${schluessel || 'Kontaktformular'}` };
  return { art: 'sonstige', text: roh };
}

/** Hinweis über dem vorausgefüllten Formular, passend zur Herkunft. */
export function vorabHinweis(quelle: string | null | undefined): string {
  const h = herkunft(quelle);
  if (quelle?.trim() === 'backoffice') return 'Die Angaben aus dem Kontaktbuch sind schon eingetragen. Prüf sie kurz und buch den Termin.';
  if (h?.playbook) return `Deine Angaben aus der Anfrage zum ${h.playbook} sind schon eingetragen. Prüf sie kurz und buch den Termin.`;
  return 'Deine Angaben von unserer Website sind schon eingetragen. Prüf sie kurz und buch den Termin.';
}
