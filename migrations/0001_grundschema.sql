-- Let's Meet: Grundschema
-- Zeiten werden als ISO 8601 in UTC gespeichert, Uhrzeiten in Regeln als Minuten ab Mitternacht
-- in der Zeitzone des jeweiligen Nutzers.

CREATE TABLE IF NOT EXISTS nutzer (
  id                    TEXT PRIMARY KEY,
  email                 TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  passwort_hash         TEXT NOT NULL,
  rolle                 TEXT NOT NULL DEFAULT 'mitglied',     -- admin, mitglied
  position              TEXT,                                  -- z. B. Geschäftsführung
  zeitzone              TEXT NOT NULL DEFAULT 'Europe/Berlin',
  begruessung           TEXT,
  avatar_url            TEXT,
  aktiv                 INTEGER NOT NULL DEFAULT 1,
  fehlversuche          INTEGER NOT NULL DEFAULT 0,
  gesperrt_bis          TEXT,
  google_email          TEXT,
  google_refresh_token  TEXT,
  google_access_token   TEXT,
  google_token_ablauf   INTEGER,
  google_kalender_id    TEXT NOT NULL DEFAULT 'primary',
  webhook_url           TEXT,
  webhook_secret        TEXT,
  erstellt_am           TEXT NOT NULL,
  aktualisiert_am       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS terminarten (
  id                  TEXT PRIMARY KEY,
  nutzer_id           TEXT NOT NULL REFERENCES nutzer(id) ON DELETE CASCADE,
  slug                TEXT NOT NULL,
  titel               TEXT NOT NULL,
  beschreibung        TEXT,
  dauer_min           INTEGER NOT NULL DEFAULT 30,
  farbe               TEXT NOT NULL DEFAULT '#DC9832',
  ort_typ             TEXT NOT NULL DEFAULT 'google_meet',  -- google_meet, telefon_wir, telefon_gast, vor_ort, link
  ort_wert            TEXT,
  puffer_vor_min      INTEGER NOT NULL DEFAULT 0,
  puffer_nach_min     INTEGER NOT NULL DEFAULT 0,
  vorlauf_min         INTEGER NOT NULL DEFAULT 240,         -- Mindestvorlauf vor Terminbeginn
  max_tage_voraus     INTEGER NOT NULL DEFAULT 60,
  raster_min          INTEGER NOT NULL DEFAULT 30,          -- Abstand der Startzeiten
  max_pro_tag         INTEGER,
  fragen              TEXT NOT NULL DEFAULT '[]',           -- JSON: [{id, label, typ, pflicht}]
  erinnerung_std      INTEGER NOT NULL DEFAULT 24,          -- 0 = keine Erinnerung
  bestaetigung_text   TEXT,
  weiterleitung_url   TEXT,
  aktiv               INTEGER NOT NULL DEFAULT 1,
  geheim              INTEGER NOT NULL DEFAULT 0,           -- nicht auf der Profilseite gelistet
  reihenfolge         INTEGER NOT NULL DEFAULT 0,
  erstellt_am         TEXT NOT NULL,
  aktualisiert_am     TEXT NOT NULL,
  UNIQUE (nutzer_id, slug)
);

CREATE TABLE IF NOT EXISTS verfuegbarkeit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nutzer_id   TEXT NOT NULL REFERENCES nutzer(id) ON DELETE CASCADE,
  wochentag   INTEGER NOT NULL,          -- 0 Sonntag bis 6 Samstag
  start_min   INTEGER NOT NULL,
  ende_min    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verf_nutzer ON verfuegbarkeit (nutzer_id, wochentag);

-- Abweichungen für einzelne Tage. start_min und ende_min NULL bedeutet: ganzer Tag nicht verfügbar.
CREATE TABLE IF NOT EXISTS ausnahmen (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nutzer_id   TEXT NOT NULL REFERENCES nutzer(id) ON DELETE CASCADE,
  datum       TEXT NOT NULL,             -- YYYY-MM-DD in der Zeitzone des Nutzers
  start_min   INTEGER,
  ende_min    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ausn_nutzer ON ausnahmen (nutzer_id, datum);

CREATE TABLE IF NOT EXISTS buchungen (
  id                  TEXT PRIMARY KEY,                       -- zufällig, dient auch als Verwaltungslink
  terminart_id        TEXT NOT NULL REFERENCES terminarten(id) ON DELETE CASCADE,
  nutzer_id           TEXT NOT NULL REFERENCES nutzer(id) ON DELETE CASCADE,
  start_utc           TEXT NOT NULL,
  ende_utc            TEXT NOT NULL,
  gast_name           TEXT NOT NULL,
  gast_email          TEXT NOT NULL,
  gast_telefon        TEXT,
  gast_zeitzone       TEXT NOT NULL,
  antworten           TEXT NOT NULL DEFAULT '[]',             -- JSON: [{label, wert}]
  nachricht           TEXT,
  status              TEXT NOT NULL DEFAULT 'bestaetigt',     -- bestaetigt, storniert
  storno_grund        TEXT,
  storniert_von       TEXT,                                   -- gast, gastgeber
  storniert_am        TEXT,
  umgebucht_von       TEXT,                                   -- id der ursprünglichen Buchung
  umgebucht_zu        TEXT,                                   -- id der neuen Buchung
  nicht_erschienen    INTEGER NOT NULL DEFAULT 0,
  interne_notiz       TEXT,
  ort_text            TEXT,
  meeting_url         TEXT,
  google_event_id     TEXT,
  erinnerung_gesendet INTEGER NOT NULL DEFAULT 0,
  quelle              TEXT,                                   -- Seite, auf der eingebettet gebucht wurde
  loeschen_ab         TEXT NOT NULL,                          -- Aufbewahrungsfrist
  erstellt_am         TEXT NOT NULL,
  aktualisiert_am     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_buch_nutzer_start ON buchungen (nutzer_id, start_utc);
CREATE INDEX IF NOT EXISTS idx_buch_status ON buchungen (status, start_utc);
CREATE INDEX IF NOT EXISTS idx_buch_loeschen ON buchungen (loeschen_ab);
