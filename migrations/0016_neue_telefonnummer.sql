-- Neue Telefonnummer des Büros (seit 2026-11-20): 0209 51303350 statt 0209 36660644.
-- Ersetzt die alte Nummer in gespeicherten Texten der Arbeitsabläufe und Terminarten.
UPDATE arbeitsablaeufe SET
  betreff = REPLACE(betreff, '0209 36660644', '0209 51303350'),
  ueberschrift = REPLACE(ueberschrift, '0209 36660644', '0209 51303350'),
  text = REPLACE(text, '0209 36660644', '0209 51303350')
WHERE betreff LIKE '%36660644%' OR ueberschrift LIKE '%36660644%' OR text LIKE '%36660644%';

UPDATE terminarten SET
  beschreibung = REPLACE(beschreibung, '0209 36660644', '0209 51303350'),
  bestaetigung_text = REPLACE(bestaetigung_text, '0209 36660644', '0209 51303350')
WHERE beschreibung LIKE '%36660644%' OR bestaetigung_text LIKE '%36660644%';
