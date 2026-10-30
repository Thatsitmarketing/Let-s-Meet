-- Kunden sollen 14 statt 7 Tage im Voraus buchen können (Kundenwunsch 2026-10-30).
-- Betrifft nur Terminarten, die noch auf 7 Tagen stehen (die fünf aktiven Gespräche und die Kopie).
UPDATE terminarten SET max_tage_voraus = 14 WHERE max_tage_voraus = 7;

-- Das Strategiegespräch Social Recruiting nannte sich in der Beschreibung „Erstgespräch“ (Kundenwunsch 2026-10-30:
-- jedes Gespräch heißt so, wie es in Let's Meet festgelegt ist).
UPDATE terminarten SET beschreibung = REPLACE(beschreibung, 'In diesem Erstgespräch', 'In diesem Strategiegespräch')
 WHERE slug = 'strategiegespraech-recruiting';
