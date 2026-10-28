-- Termine aus dem Google Kalender des Büros. Der Cron gleicht sie alle zehn Minuten ab,
-- das Backoffice zeigt sie mit Titel im Kalender. Ganztägige Einträge stehen mit Mitternacht
-- in der Zone des Büros als start_utc und ende_utc (Ende exklusiv) in der Tabelle.
CREATE TABLE IF NOT EXISTS google_termine (
  nutzer_id       TEXT NOT NULL REFERENCES nutzer (id) ON DELETE CASCADE,
  event_id        TEXT NOT NULL,
  titel           TEXT NOT NULL,
  start_utc       TEXT NOT NULL,
  ende_utc        TEXT NOT NULL,
  ganztaegig      INTEGER NOT NULL DEFAULT 0,
  blockiert       INTEGER NOT NULL DEFAULT 1,   -- 0: ganztägig, „Verfügbar“, abgelehnt oder Titel aus der Ignorierliste
  ort             TEXT,
  link            TEXT,                         -- Adresse des Termins in Google Kalender
  aktualisiert_am TEXT NOT NULL,
  PRIMARY KEY (nutzer_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_gtermine_nutzer_start ON google_termine (nutzer_id, start_utc);

ALTER TABLE nutzer ADD COLUMN google_abgleich_am TEXT;
ALTER TABLE nutzer ADD COLUMN google_abgleich_fehler TEXT;
