/** Kurze Rückmeldungen nach Weiterleitungen (PRG Muster), gesteuert über ?ok= */
const TEXTE: Record<string, string> = {
  gespeichert: 'Gespeichert.',
  angelegt: 'Angelegt.',
  geloescht: 'Gelöscht.',
  dupliziert: 'Kopie angelegt.',
  abgesagt: 'Termin abgesagt. Der Gast wurde per Mail informiert.',
  willkommen: 'Willkommen bei Let\'s Meet. Deine erste Terminart ist schon angelegt.',
  google: 'Google Kalender verbunden. Die Termine sind übernommen.',
  abgeglichen: 'Google Kalender abgeglichen.',
  google_geloescht: 'Termin im Google Kalender gelöscht.',
  getrennt: 'Verbindung getrennt.',
  passwort: 'Passwort geändert.',
};

export function meldungAusUrl(url: URL): { art: 'erfolg' | 'fehler'; text: string } | null {
  const ok = url.searchParams.get('ok');
  if (ok && TEXTE[ok]) return { art: 'erfolg', text: TEXTE[ok] };
  const fehler = url.searchParams.get('fehler');
  if (fehler) return { art: 'fehler', text: fehler.slice(0, 200) };
  return null;
}
