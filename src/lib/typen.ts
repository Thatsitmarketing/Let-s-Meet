export interface Nutzer {
  id: string;
  email: string;
  name: string;
  slug: string;
  passwort_hash: string;
  rolle: 'admin' | 'mitglied';
  position: string | null;
  zeitzone: string;
  begruessung: string | null;
  avatar_url: string | null;
  aktiv: number;
  fehlversuche: number;
  gesperrt_bis: string | null;
  google_email: string | null;
  google_refresh_token: string | null;
  google_access_token: string | null;
  google_token_ablauf: number | null;
  google_kalender_id: string;
  google_abgleich_am: string | null;
  google_abgleich_fehler: string | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  ist_buero: number;
  erstellt_am: string;
  aktualisiert_am: string;
}

export type OrtTyp = 'google_meet' | 'telefon_wir' | 'telefon_gast' | 'vor_ort' | 'link';

export interface Frage {
  id: string;
  label: string;
  typ: 'text' | 'textarea' | 'telefon';
  pflicht: boolean;
}

/** Unterlage zur Vorbereitung, rechts neben dem Kalender verlinkt. */
export interface Unterlage {
  titel: string;
  url: string;
  info: string;
  bild: string;
}

export interface Terminart {
  id: string;
  nutzer_id: string;
  slug: string;
  titel: string;
  beschreibung: string | null;
  dauer_min: number;
  farbe: string;
  ort_typ: OrtTyp;
  ort_wert: string | null;
  puffer_vor_min: number;
  puffer_nach_min: number;
  vorlauf_min: number;
  max_tage_voraus: number;
  raster_min: number;
  max_pro_tag: number | null;
  fragen: string;
  unterlagen: string;
  /** Veraltet, ersetzt durch erinnerungen */
  erinnerung_std: number;
  /** JSON Liste: Minuten vor Terminbeginn, zu denen der Gast erinnert wird */
  erinnerungen: string;
  bestaetigung_text: string | null;
  weiterleitung_url: string | null;
  aktiv: number;
  geheim: number;
  reihenfolge: number;
  erstellt_am: string;
  aktualisiert_am: string;
}

export interface Buchung {
  id: string;
  terminart_id: string;
  nutzer_id: string;
  start_utc: string;
  ende_utc: string;
  gast_name: string;
  gast_email: string;
  gast_telefon: string | null;
  gast_zeitzone: string;
  antworten: string;
  nachricht: string | null;
  status: 'bestaetigt' | 'storniert';
  storno_grund: string | null;
  storniert_von: 'gast' | 'gastgeber' | null;
  storniert_am: string | null;
  umgebucht_von: string | null;
  umgebucht_zu: string | null;
  nicht_erschienen: number;
  interne_notiz: string | null;
  ort_text: string | null;
  meeting_url: string | null;
  google_event_id: string | null;
  /** Veraltet, ersetzt durch erinnerungen_gesendet */
  erinnerung_gesendet: number;
  /** JSON Liste der schon versendeten Erinnerungen (Minuten) */
  erinnerungen_gesendet: string;
  quelle: string | null;
  loeschen_ab: string;
  erstellt_am: string;
  aktualisiert_am: string;
}

export interface Kontakt {
  id: string;
  nutzer_id: string;
  name: string;
  email: string | null;
  telefon: string | null;
  unternehmen: string | null;
  notiz: string | null;
  quelle: 'buchung' | 'google' | 'import' | 'manuell';
  letztes_meeting: string | null;
  ausgeblendet: number;
  erstellt_am: string;
  aktualisiert_am: string;
}

/** Auswahl für Erinnerungsmails an den Gast, Werte in Minuten vor Terminbeginn */
export const ERINNERUNG_OPTIONEN: { min: number; text: string }[] = [
  { min: 10080, text: '7 Tage' },
  { min: 2880, text: '48 Stunden' },
  { min: 1440, text: '24 Stunden' },
  { min: 720, text: '12 Stunden' },
  { min: 240, text: '4 Stunden' },
  { min: 120, text: '2 Stunden' },
  { min: 60, text: '1 Stunde' },
  { min: 30, text: '30 Minuten' },
];

export interface Regel {
  wochentag: number;
  start_min: number;
  ende_min: number;
}

export interface Ausnahme {
  id: number;
  datum: string;
  start_min: number | null;
  ende_min: number | null;
}

export const ORT_LABEL: Record<OrtTyp, string> = {
  google_meet: 'Google Meet',
  telefon_wir: 'Telefon, wir rufen an',
  telefon_gast: 'Telefon, du rufst an',
  vor_ort: 'Vor Ort',
  link: 'Videolink',
};

/** Farben für Terminarten. Orange bleibt Akzent, die übrigen Töne kommen aus dem Neutral und Semantiksystem der Marke. */
export const FARBEN = [
  { wert: '#DC9832', name: 'Orange' },
  { wert: '#0E0E0E', name: 'Schwarz' },
  { wert: '#6E6E6E', name: 'Grau' },
  { wert: '#2F8F5F', name: 'Grün' },
  { wert: '#2B6CB0', name: 'Blau' },
  { wert: '#C4382C', name: 'Rot' },
];
