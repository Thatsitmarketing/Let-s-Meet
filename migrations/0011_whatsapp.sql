-- WhatsApp Bot für die Leads der Landingpage "Kostenloser Website-Entwurf".
-- Ein Gespräch je Lead, Nachrichtenverlauf getrennt. Siehe src/lib/whatsapp/.

CREATE TABLE IF NOT EXISTS wa_gespraeche (
  id TEXT PRIMARY KEY,
  telefon TEXT NOT NULL,                 -- wa_id, Ziffern ohne +, z. B. 4917012345678
  name TEXT NOT NULL,
  vorname TEXT NOT NULL,
  firma TEXT,
  webseite TEXT,
  email TEXT,
  hat_website INTEGER NOT NULL DEFAULT 1,
  quelle TEXT,
  hinweise TEXT,                         -- Hinweise der Landingpage (Agenturverdacht usw.)
  schritt TEXT NOT NULL DEFAULT 'start', -- start, problem, problem_text, ziel, zeitpunkt, budget, einwand, termin, wunschzeit, entscheider, entscheider_text, briefing, fertig
  status TEXT NOT NULL DEFAULT 'offen',  -- offen, gebucht, verabschiedet, anrufen, mensch, abgemeldet
  heiss INTEGER NOT NULL DEFAULT 0,
  problem TEXT,
  ziel TEXT,
  zeitpunkt TEXT,
  budget TEXT,
  einwand_versuche INTEGER NOT NULL DEFAULT 0,
  entscheider TEXT,
  briefing TEXT,
  angebotene_slots TEXT,                 -- JSON Liste von UTC Zeitpunkten
  buchung_id TEXT,
  start_faellig_am TEXT,                 -- erste Nachricht erst morgens, wenn der Lead nachts kommt
  start_gesendet_am TEXT,
  letzte_eingang_am TEXT,
  letzte_ausgang_am TEXT,
  nachfass_stufe INTEGER NOT NULL DEFAULT 0,
  team_informiert_am TEXT,
  erinnerung_gesendet INTEGER NOT NULL DEFAULT 0,
  in_arbeit_bis TEXT,                    -- einfache Sperre, damit zwei Nachrichten nicht parallel laufen
  fehler TEXT,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS wa_gespraeche_telefon ON wa_gespraeche (telefon, erstellt_am);
CREATE INDEX IF NOT EXISTS wa_gespraeche_status ON wa_gespraeche (status, schritt);

CREATE TABLE IF NOT EXISTS wa_nachrichten (
  id TEXT PRIMARY KEY,
  gespraech_id TEXT NOT NULL,
  richtung TEXT NOT NULL,                -- ein, aus, team (vom Team aus der WhatsApp App)
  art TEXT NOT NULL,                     -- text, knopf, vorlage, sprache, sonstiges
  text TEXT NOT NULL,
  wert TEXT,                             -- ID eines gedrückten Knopfs
  wa_message_id TEXT,
  verarbeitet INTEGER NOT NULL DEFAULT 1,
  erstellt_am TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS wa_nachrichten_gespraech ON wa_nachrichten (gespraech_id, erstellt_am);
CREATE UNIQUE INDEX IF NOT EXISTS wa_nachrichten_meta ON wa_nachrichten (wa_message_id) WHERE wa_message_id IS NOT NULL;
