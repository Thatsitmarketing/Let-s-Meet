-- Let's Meet: zentrale Buchung über das Büro statt über einzelne Teammitglieder
--
-- Das Büro ist ein Eintrag in nutzer mit ist_buero = 1. Ihm gehören alle öffentlichen Terminarten,
-- die Verfügbarkeit, die Google Verbindung (Kalender von info@thatsit.marketing) und die Buchungen.
-- Teammitglieder melden sich weiter mit ihrem eigenen Konto an und verwalten das Büro gemeinsam.

ALTER TABLE nutzer ADD COLUMN ist_buero INTEGER NOT NULL DEFAULT 0;

-- Unterlagen zur Vorbereitung je Terminart, JSON: [{titel, url, info, bild}]
ALTER TABLE terminarten ADD COLUMN unterlagen TEXT NOT NULL DEFAULT '[]';

-- 1. Ein vorhandenes Konto mit info@thatsit.marketing wird zum Büro
UPDATE nutzer
   SET ist_buero = 1,
       name = 'That''s it. Marketing',
       position = 'Büro Gelsenkirchen',
       aktualisiert_am = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE email = 'info@thatsit.marketing';

-- 2. Sonst wird das Büro neu angelegt. Das Passwort '!' ist kein gültiger Hash, damit ist keine Anmeldung möglich
INSERT INTO nutzer (id, email, name, slug, passwort_hash, rolle, position, zeitzone, aktiv, ist_buero, erstellt_am, aktualisiert_am)
SELECT lower(hex(randomblob(13))), 'info@thatsit.marketing', 'That''s it. Marketing', 'buero', '!', 'mitglied', 'Büro Gelsenkirchen',
       'Europe/Berlin', 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE NOT EXISTS (SELECT 1 FROM nutzer WHERE ist_buero = 1);

-- 3. Standardverfügbarkeit Mo bis Fr 9 bis 17 Uhr, falls das Büro noch keine hat
INSERT INTO verfuegbarkeit (nutzer_id, wochentag, start_min, ende_min)
SELECT n.id, t.tag, 540, 1020
  FROM nutzer n, (SELECT 1 AS tag UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5) t
 WHERE n.ist_buero = 1
   AND NOT EXISTS (SELECT 1 FROM verfuegbarkeit v WHERE v.nutzer_id = n.id);

-- 4. Erstgespräch für das Büro, falls es noch keins gibt
INSERT INTO terminarten (id, nutzer_id, slug, titel, dauer_min, farbe, ort_typ, raster_min, erstellt_am, aktualisiert_am)
SELECT lower(hex(randomblob(13))), n.id, 'erstgespraech', 'Erstgespräch', 30, '#DC9832', 'google_meet', 30,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM nutzer n
 WHERE n.ist_buero = 1
   AND NOT EXISTS (SELECT 1 FROM terminarten t WHERE t.nutzer_id = n.id AND t.slug = 'erstgespraech');

-- 5. Beschreibung und Unterlagen für das Erstgespräch, nur wenn noch nichts eingetragen ist
UPDATE terminarten
   SET beschreibung = 'In 30 Minuten lernen wir dich und dein Unternehmen kennen. Wir schauen gemeinsam auf deine Ziele und deinen aktuellen Auftritt: Website, Google Profil und Social Media. Danach weißt du, wo die größten Hebel liegen und wie ein sinnvoller nächster Schritt aussieht.

So holst du das Meiste raus:
Link zu deiner Website und deinen Kanälen bereithalten
Überlegen, was sich in den nächsten sechs Monaten verändern soll
Grob wissen, welcher Zeitrahmen und welches Budget realistisch sind',
       unterlagen = '[{"titel":"Website Conversion Playbook 2026","url":"https://website-conversion-playbook.thatsit.marketing/","info":"Wie deine Website zum Vertriebsmitarbeiter wird, der rund um die Uhr arbeitet","bild":"/images/unterlagen/website-playbook.webp"},{"titel":"Social Media Playbook","url":"https://social-media-playbook.thatsit.marketing/","info":"Ziel, Zielgruppe, Kanäle und Formate, die Reichweite bringen","bild":"/images/unterlagen/social-media-playbook.webp"},{"titel":"Social Recruiting Playbook","url":"https://social-recruiting-playbook.thatsit.marketing/","info":"So gewinnst du neue Mitarbeiter über Social Media","bild":"/images/unterlagen/recruiting-playbook.webp"},{"titel":"Gastro Marketing Playbook","url":"https://gastro-marketing-playbook.thatsit.marketing/","info":"Mehr Gäste statt leerer Tische","bild":"/images/unterlagen/gastro-playbook.webp"},{"titel":"Referenzen","url":"https://thatsit.marketing/referenzen/","info":"Ausgewählte Projekte unserer Kunden","bild":""}]',
       aktualisiert_am = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE slug = 'erstgespraech'
   AND (beschreibung IS NULL OR beschreibung = '')
   AND nutzer_id IN (SELECT id FROM nutzer WHERE ist_buero = 1);

-- 6. Persönliche Terminarten sind nicht mehr öffentlich buchbar (Daten bleiben erhalten)
UPDATE terminarten
   SET aktiv = 0, aktualisiert_am = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE nutzer_id IN (SELECT id FROM nutzer WHERE ist_buero = 0);
