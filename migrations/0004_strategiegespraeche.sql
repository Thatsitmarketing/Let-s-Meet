-- Vier Strategiegespräche statt eines Erstgesprächs, passend zu den Leistungen der Homepage.
-- strategiegespraech (allgemein), strategiegespraech-social-media, strategiegespraech-recruiting, sichtbarkeits-check.
-- Der alte Link /erstgespraech leitet in der Anwendung auf /strategiegespraech weiter.
UPDATE terminarten
SET slug = 'strategiegespraech',
    titel = 'Kostenfreies Strategiegespräch',
    beschreibung = 'Du brauchst Unterstützung im Marketing, aber weißt nicht genau, wo du zuerst anfangen sollst? Genau dafür sind diese 60 Minuten gedacht.' || char(10) || char(10) ||
      'Nach diesem Gespräch hast du eine klare, realistische und umsetzbare Marketing Strategie, die genau zu deinem Unternehmen passt.' || char(10) || char(10) ||
      'So holst du das Meiste raus:' || char(10) ||
      'Link zu deiner Website und deinen Kanälen bereithalten' || char(10) ||
      'Überlegen, was sich in den nächsten sechs Monaten verändern soll' || char(10) ||
      'Grob wissen, welcher Zeitrahmen und welches Budget realistisch sind',
    reihenfolge = 0,
    aktualisiert_am = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE slug = 'erstgespraech' AND nutzer_id = (SELECT id FROM nutzer WHERE ist_buero = 1);

INSERT OR IGNORE INTO terminarten (id, nutzer_id, slug, titel, beschreibung, dauer_min, farbe, ort_typ, reihenfolge, unterlagen, erstellt_am, aktualisiert_am)
SELECT lower(hex(randomblob(13))), b.id, 'strategiegespraech-social-media', 'Strategiegespräch Social Media Marketing',
  'In diesem kostenlosen Gespräch ermitteln wir eine Strategie, wie sich dein Unternehmen am besten auf Social Media vermarkten lässt.' || char(10) || char(10) ||
  'Wir prüfen, welche nächsten Schritte sinnvoll sind, und geben dir einen konkreten Fahrplan an die Hand.' || char(10) || char(10) ||
  'So holst du das Meiste raus:' || char(10) ||
  'Links zu deinen Profilen bereithalten' || char(10) ||
  'Überlegen, was Social Media für dich leisten soll: Anfragen, Reichweite oder Bewerber' || char(10) ||
  'Grob wissen, wie viel Zeit und Budget realistisch sind',
  60, '#2B6CB0', 'google_meet', 1, '[]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM nutzer b WHERE b.ist_buero = 1;

INSERT OR IGNORE INTO terminarten (id, nutzer_id, slug, titel, beschreibung, dauer_min, farbe, ort_typ, reihenfolge, unterlagen, erstellt_am, aktualisiert_am)
SELECT lower(hex(randomblob(13))), b.id, 'strategiegespraech-recruiting', 'Strategiegespräch Social Recruiting',
  'In diesem Gespräch lernen wir dich und dein Unternehmen kennen. Wir sprechen über deine aktuelle Situation, deine Ziele und das, was du dir von Social Recruiting erwartest.' || char(10) || char(10) ||
  'Der Termin dient als Grundlage, um zu prüfen, welche nächsten Schritte sinnvoll sind und ob sowie wie wir dich unterstützen können.' || char(10) || char(10) ||
  'Unverbindlich, strukturiert und auf Augenhöhe.' || char(10) || char(10) ||
  'So holst du das Meiste raus:' || char(10) ||
  'Wissen, welche Stellen du besetzen willst' || char(10) ||
  'Link zu deiner Karriereseite oder Stellenanzeige bereithalten' || char(10) ||
  'Überlegen, wen du suchst und was dich als Arbeitgeber besonders macht',
  60, '#2F8F5F', 'google_meet', 2, '[]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM nutzer b WHERE b.ist_buero = 1;

INSERT OR IGNORE INTO terminarten (id, nutzer_id, slug, titel, beschreibung, dauer_min, farbe, ort_typ, reihenfolge, unterlagen, erstellt_am, aktualisiert_am)
SELECT lower(hex(randomblob(13))), b.id, 'sichtbarkeits-check', 'Kostenloser Sichtbarkeits-Check für dein Lokal',
  'Gemeinsam schauen wir auf folgende Punkte:' || char(10) ||
  'Google Profil: Vollständigkeit, Kategorie, Merkmale' || char(10) ||
  'Website: Check auf dem Handy' || char(10) ||
  'Instagram: Reicht dein Profil allein?' || char(10) ||
  'Content: Wir sehen uns deine Bilder an und sagen, was besser geht' || char(10) ||
  'Bewertungen: Deine Google Bewertungen und wie sie beantwortet werden',
  45, '#8B5CF6', 'google_meet', 3, '[]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM nutzer b WHERE b.ist_buero = 1;
