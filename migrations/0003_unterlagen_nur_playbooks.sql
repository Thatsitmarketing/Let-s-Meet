-- Unterlagen zur Vorbereitung: nur noch die vier Playbooks, der Link auf die Referenzen entfällt.
-- Die Buchungsseite filtert die Playbooks nach dem Interesse aus der Anfrage.
UPDATE terminarten
SET unterlagen = (
      SELECT COALESCE(json_group_array(json(value)), '[]')
      FROM json_each(terminarten.unterlagen)
      WHERE COALESCE(json_extract(value, '$.url'), '') NOT LIKE '%thatsit.marketing/referenzen%'
    ),
    aktualisiert_am = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE unterlagen LIKE '%thatsit.marketing/referenzen%';
