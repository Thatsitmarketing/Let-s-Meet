-- Mehrere Erinnerungen je Terminart und Kontaktbuch.

-- Erinnerungen als JSON Liste in Minuten vor Terminbeginn, Standard 24 Stunden und 1 Stunde.
-- Die alte Spalte erinnerung_std bleibt stehen, wird aber nicht mehr genutzt.
ALTER TABLE terminarten ADD COLUMN erinnerungen TEXT NOT NULL DEFAULT '[1440,60]';
UPDATE terminarten SET erinnerungen = CASE WHEN erinnerung_std > 0 THEN '[1440,60]' ELSE '[]' END;

-- Welche Erinnerungen (Minuten) eine Buchung schon bekommen hat
ALTER TABLE buchungen ADD COLUMN erinnerungen_gesendet TEXT NOT NULL DEFAULT '[]';
UPDATE buchungen SET erinnerungen_gesendet = (
  SELECT '[' || (t.erinnerung_std * 60) || ']' FROM terminarten t WHERE t.id = buchungen.terminart_id
) WHERE erinnerung_gesendet = 1;

-- Gäste eines Google Termins (E Mail Adressen in Kleinbuchstaben, JSON Liste), für das Kontaktbuch
ALTER TABLE google_termine ADD COLUMN gaeste TEXT;

-- Kontaktbuch des Büros. Füllt sich aus Buchungen, Gästen im Google Kalender, Import und Hand.
-- Letztes und nächstes Meeting werden aus buchungen und google_termine berechnet,
-- letztes_meeting hält den Stand fest, damit er nach den Löschfristen erhalten bleibt.
CREATE TABLE IF NOT EXISTS kontakte (
  id               TEXT PRIMARY KEY,
  nutzer_id        TEXT NOT NULL REFERENCES nutzer (id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  email            TEXT,                                 -- Kleinbuchstaben, optional
  telefon          TEXT,
  unternehmen      TEXT,
  notiz            TEXT,
  quelle           TEXT NOT NULL DEFAULT 'manuell',      -- buchung, google, import, manuell
  letztes_meeting  TEXT,                                 -- Beginn in UTC
  ausgeblendet     INTEGER NOT NULL DEFAULT 0,           -- entfernt, kommt über Google nicht zurück
  erstellt_am      TEXT NOT NULL,
  aktualisiert_am  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kontakte_email ON kontakte (nutzer_id, email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kontakte_name ON kontakte (nutzer_id, name);

-- Bisherige Gäste übernehmen (jüngste Buchung liefert den Namen, Telefon aus der jüngsten Buchung mit Nummer)
INSERT OR IGNORE INTO kontakte (id, nutzer_id, name, email, telefon, quelle, letztes_meeting, erstellt_am, aktualisiert_am)
SELECT lower(hex(randomblob(12))), b.nutzer_id, b.gast_name, lower(b.gast_email),
  (SELECT z.gast_telefon FROM buchungen z WHERE z.nutzer_id = b.nutzer_id AND lower(z.gast_email) = lower(b.gast_email)
     AND z.gast_telefon IS NOT NULL ORDER BY z.erstellt_am DESC LIMIT 1),
  'buchung',
  (SELECT MAX(x.start_utc) FROM buchungen x WHERE x.nutzer_id = b.nutzer_id AND lower(x.gast_email) = lower(b.gast_email)
     AND x.status = 'bestaetigt' AND x.nicht_erschienen = 0 AND x.start_utc < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  b.erstellt_am, b.erstellt_am
FROM buchungen b
WHERE b.rowid = (SELECT y.rowid FROM buchungen y WHERE y.nutzer_id = b.nutzer_id AND lower(y.gast_email) = lower(b.gast_email) ORDER BY y.erstellt_am DESC LIMIT 1);
