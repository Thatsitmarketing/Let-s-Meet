-- Weitere Termine aus Calendly. Geheim: nicht in der Auswahl, nicht indexiert, nur per Link buchbar.
-- Die Homepage verlinkt sie nicht.
INSERT OR IGNORE INTO terminarten (id, nutzer_id, slug, titel, beschreibung, dauer_min, farbe, ort_typ, geheim, reihenfolge, unterlagen, erstellt_am, aktualisiert_am)
SELECT lower(hex(randomblob(13))), b.id, v.slug, v.titel, v.beschreibung, v.dauer, v.farbe, v.ort, 1, v.pos, '[]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM nutzer b,
  (SELECT 'erstgespraech-webseite' AS slug, 'Erstgespräch Webseite' AS titel, 'In diesem Gespräch lernen wir dich und dein Unternehmen kennen und sprechen über deine Website: Ziele, aktueller Stand und sinnvolle nächste Schritte.' AS beschreibung, 30 AS dauer, '#DC9832' AS farbe, 'google_meet' AS ort, 4 AS pos
   UNION ALL SELECT 'erstgespraech-anruf', 'Erstgespräch per Anruf', 'Wir rufen dich zum Wunschtermin an und lernen dich und dein Unternehmen kennen. Bitte trag deine Telefonnummer ein.', 30, '#FF5A00', 'telefon_wir', 5
   UNION ALL SELECT '30-minuten', '30 Minute Meeting', 'Ein kurzes Gespräch von 30 Minuten per Videocall.', 30, '#8B5CF6', 'google_meet', 6) v
WHERE b.ist_buero = 1;
