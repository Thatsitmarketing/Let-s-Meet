-- Arbeitsabläufe wie bei Calendly: wenn etwas passiert, schick eine Mail.
-- Ersetzt die Erinnerungen in terminarten.erinnerungen. Die alten Spalten bleiben stehen, werden aber nicht mehr gelesen.

CREATE TABLE IF NOT EXISTS arbeitsablaeufe (
  id                TEXT PRIMARY KEY,
  nutzer_id         TEXT NOT NULL REFERENCES nutzer (id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  ausloeser         TEXT NOT NULL,                -- nach_buchung, vor_beginn, nach_ende, bei_absage, nicht_erschienen
  versatz_min       INTEGER NOT NULL DEFAULT 0,   -- Minuten vor Beginn, nach Ende oder nach der Buchung, 0 = sofort
  aktion            TEXT NOT NULL,                -- mail_gast, mail_buero, mail_an
  empfaenger        TEXT,                         -- bei mail_an: Adressen, durch Komma getrennt
  betreff           TEXT NOT NULL,
  ueberschrift      TEXT,
  text              TEXT NOT NULL,                -- mit Platzhaltern wie {vorname}
  alle_terminarten  INTEGER NOT NULL DEFAULT 0,   -- gilt für alle, auch künftige Terminarten
  aktiv             INTEGER NOT NULL DEFAULT 1,
  erstellt_am       TEXT NOT NULL,
  aktualisiert_am   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ablaeufe_nutzer ON arbeitsablaeufe (nutzer_id, ausloeser);

-- Zuordnung zu einzelnen Terminarten (nur wenn alle_terminarten = 0)
CREATE TABLE IF NOT EXISTS arbeitsablauf_terminarten (
  arbeitsablauf_id  TEXT NOT NULL REFERENCES arbeitsablaeufe (id) ON DELETE CASCADE,
  terminart_id      TEXT NOT NULL REFERENCES terminarten (id) ON DELETE CASCADE,
  PRIMARY KEY (arbeitsablauf_id, terminart_id)
);
CREATE INDEX IF NOT EXISTS idx_ablauf_ta_terminart ON arbeitsablauf_terminarten (terminart_id);

-- Jede Buchung bekommt jeden Arbeitsablauf höchstens einmal
CREATE TABLE IF NOT EXISTS arbeitsablauf_versand (
  arbeitsablauf_id  TEXT NOT NULL REFERENCES arbeitsablaeufe (id) ON DELETE CASCADE,
  buchung_id        TEXT NOT NULL REFERENCES buchungen (id) ON DELETE CASCADE,
  status            TEXT NOT NULL,                -- gesendet, entfallen, fehler
  gesendet_am       TEXT NOT NULL,
  PRIMARY KEY (arbeitsablauf_id, buchung_id)
);
CREATE INDEX IF NOT EXISTS idx_versand_buchung ON arbeitsablauf_versand (buchung_id);
CREATE INDEX IF NOT EXISTS idx_versand_zeit ON arbeitsablauf_versand (arbeitsablauf_id, gesendet_am);

-- Standardabläufe für das Büro aus den bisherigen Erinnerungen und dem Ablauf „Nicht erschienen“ aus Calendly.
-- Gilt eine Erinnerung für alle Terminarten, wird sie zu „alle Terminarten“, sonst einzeln zugeordnet.
INSERT OR IGNORE INTO arbeitsablaeufe (id, nutzer_id, name, ausloeser, versatz_min, aktion, betreff, ueberschrift, text, alle_terminarten, aktiv, erstellt_am, aktualisiert_am)
SELECT 'standard-erinnerung-24h', n.id, 'Erinnerung 24 Stunden vorher', 'vor_beginn', 1440, 'mail_gast',
  'Erinnerung: {terminart} {wann}', 'Wir sehen uns {wann}',
  'Hallo {vorname},' || char(10) || char(10) || 'kurze Erinnerung an deinen Termin. Falls etwas dazwischenkommt, buche einfach um.',
  CASE WHEN EXISTS (SELECT 1 FROM terminarten t WHERE t.nutzer_id = n.id AND NOT EXISTS (SELECT 1 FROM json_each(t.erinnerungen) j WHERE j.value = 1440)) THEN 0 ELSE 1 END,
  1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM nutzer n WHERE n.ist_buero = 1;

INSERT OR IGNORE INTO arbeitsablaeufe (id, nutzer_id, name, ausloeser, versatz_min, aktion, betreff, ueberschrift, text, alle_terminarten, aktiv, erstellt_am, aktualisiert_am)
SELECT 'standard-erinnerung-1h', n.id, 'Erinnerung 1 Stunde vorher', 'vor_beginn', 60, 'mail_gast',
  'Erinnerung: {terminart} {wann}', 'Wir sehen uns {wann}',
  'Hallo {vorname},' || char(10) || char(10) || 'gleich ist es so weit. Falls etwas dazwischenkommt, buche einfach um.',
  CASE WHEN EXISTS (SELECT 1 FROM terminarten t WHERE t.nutzer_id = n.id AND NOT EXISTS (SELECT 1 FROM json_each(t.erinnerungen) j WHERE j.value = 60)) THEN 0 ELSE 1 END,
  1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM nutzer n WHERE n.ist_buero = 1;

INSERT OR IGNORE INTO arbeitsablaeufe (id, nutzer_id, name, ausloeser, versatz_min, aktion, betreff, ueberschrift, text, alle_terminarten, aktiv, erstellt_am, aktualisiert_am)
SELECT 'standard-nicht-erschienen', n.id, 'Nicht erschienen: neue Zeit anbieten', 'nicht_erschienen', 0, 'mail_gast',
  'Schade, dass es nicht geklappt hat', 'Wir haben dich vermisst',
  'Hallo {vorname},' || char(10) || char(10) || 'zu deinem Termin {terminart} am {datum} haben wir uns leider verpasst. Kein Problem: Such dir einfach eine neue Zeit aus, wir freuen uns auf das Gespräch.',
  1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM nutzer n WHERE n.ist_buero = 1;

INSERT OR IGNORE INTO arbeitsablauf_terminarten (arbeitsablauf_id, terminart_id)
SELECT a.id, t.id FROM arbeitsablaeufe a
JOIN terminarten t ON t.nutzer_id = a.nutzer_id
WHERE a.id IN ('standard-erinnerung-24h', 'standard-erinnerung-1h') AND a.alle_terminarten = 0
  AND EXISTS (SELECT 1 FROM json_each(t.erinnerungen) j WHERE j.value = a.versatz_min);

-- Schon versendete Erinnerungen übernehmen, damit nichts doppelt rausgeht
INSERT OR IGNORE INTO arbeitsablauf_versand (arbeitsablauf_id, buchung_id, status, gesendet_am)
SELECT a.id, b.id, 'gesendet', b.aktualisiert_am FROM buchungen b
JOIN arbeitsablaeufe a ON a.nutzer_id = b.nutzer_id AND a.id IN ('standard-erinnerung-24h', 'standard-erinnerung-1h')
WHERE EXISTS (SELECT 1 FROM json_each(b.erinnerungen_gesendet) j WHERE j.value = a.versatz_min);
