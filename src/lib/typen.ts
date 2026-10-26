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
  webhook_url: string | null;
  webhook_secret: string | null;
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
  erinnerung_std: number;
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
  erinnerung_gesendet: number;
  quelle: string | null;
  loeschen_ab: string;
  erstellt_am: string;
  aktualisiert_am: string;
}

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
