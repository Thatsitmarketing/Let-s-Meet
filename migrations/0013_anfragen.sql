-- Anfragen über Landingpages, die keine Playbooks sind (seit 2026-11-16: Website Entwurf Funnel,
-- website-entwurf.thatsit.marketing). Eine Zeile je Anfrage, Kontakt im Kontaktbuch daneben.
-- antworten: JSON [{ "frage": "Teamgröße", "antwort": "2 bis 10" }], Fragen bestimmt die Landingpage.
-- dublette: die Landingpage hat dieselbe E Mail oder Nummer in den letzten 30 Tagen schon gesehen.
CREATE TABLE IF NOT EXISTS anfragen (
  id           TEXT PRIMARY KEY,
  nutzer_id    TEXT NOT NULL REFERENCES nutzer (id) ON DELETE CASCADE,
  kontakt_id   TEXT REFERENCES kontakte (id) ON DELETE SET NULL,
  quelle       TEXT NOT NULL,            -- website-entwurf
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,            -- Kleinbuchstaben
  telefon      TEXT,
  unternehmen  TEXT,
  antworten    TEXT,
  seite        TEXT,
  dublette     INTEGER NOT NULL DEFAULT 0,
  erstellt_am  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_anfragen_liste ON anfragen (nutzer_id, erstellt_am);
CREATE INDEX IF NOT EXISTS idx_anfragen_kontakt ON anfragen (kontakt_id, erstellt_am);
