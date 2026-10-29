-- Persönliche Links zu den Playbooks (Website Conversion, Social Media, Social Recruiting, Gastro Marketing).
-- Die Landingpages fordern über /api/playbook/anfordern je Anfrage einen Link an und schicken ihn per Mail.
-- Die ID ist das Geheimnis im Link (/playbook/{id}), gültig 30 Tage. Öffnen und Herunterladen werden gezählt
-- und erscheinen im Kontaktbuch und in der Leadliste (/app/playbook-leads). Einträge fallen 12 Monate nach Ablauf weg (Cron).
CREATE TABLE IF NOT EXISTS playbook_zugaenge (
  id                  TEXT PRIMARY KEY,
  nutzer_id           TEXT NOT NULL REFERENCES nutzer (id) ON DELETE CASCADE,
  kontakt_id          TEXT REFERENCES kontakte (id) ON DELETE SET NULL,
  playbook            TEXT NOT NULL,            -- website, social, recruiting, gastro
  name                TEXT NOT NULL,
  email               TEXT NOT NULL,            -- Kleinbuchstaben
  telefon             TEXT,
  unternehmen         TEXT,
  erstellt_am         TEXT NOT NULL,
  gueltig_bis         TEXT NOT NULL,
  erstmals_geoeffnet  TEXT,
  zuletzt_geoeffnet   TEXT,
  aufrufe             INTEGER NOT NULL DEFAULT 0,
  erstmals_geladen    TEXT,
  zuletzt_geladen     TEXT,
  downloads           INTEGER NOT NULL DEFAULT 0,
  gesperrt            INTEGER NOT NULL DEFAULT 0,
  link_versendet      INTEGER NOT NULL DEFAULT 1  -- 0: noch keine Dateien in Let's Meet, die Mail hatte den alten Downloadlink
);
CREATE INDEX IF NOT EXISTS idx_playbook_zugaenge_kontakt ON playbook_zugaenge (kontakt_id, erstellt_am);
CREATE INDEX IF NOT EXISTS idx_playbook_zugaenge_email ON playbook_zugaenge (nutzer_id, email);
CREATE INDEX IF NOT EXISTS idx_playbook_zugaenge_ablauf ON playbook_zugaenge (gueltig_bis);
CREATE INDEX IF NOT EXISTS idx_playbook_zugaenge_liste ON playbook_zugaenge (nutzer_id, erstellt_am);
