-- Neue Texte der drei Standardabläufe (2026-11-16): persönlicher, mit konkreter Hilfe statt Floskeln.
-- Ändert nur Abläufe, deren Text noch dem alten Standard entspricht, eigene Anpassungen bleiben.
-- Zeilen mit „* “ werden in der Mail zur Liste, **so** wird fett (textAlsHtml in src/lib/mail.ts).

UPDATE arbeitsablaeufe SET betreff = '{vorname}, morgen ist es so weit', ueberschrift = 'Morgen sprechen wir uns', text = 'Hallo {vorname},

morgen um {uhrzeit} Uhr ist es so weit: **{terminart}**. Wir haben uns die Zeit fest geblockt und schauen uns vorab schon an, wo du gerade stehst.

Damit es ganz entspannt wird:
* Den Link zum Meeting findest du unten. Läuft direkt im Browser, du musst nichts installieren.
* Bring mit, was dich gerade am meisten beschäftigt. Genau darum geht es.
* Unterlagen, Links oder Zahlen, die wir kennen sollten? Antworte einfach auf diese Mail.

Etwas dazwischengekommen? Kein Stress, unten kannst du mit zwei Klicks umbuchen.

Bis morgen
Dein Team von That''s it. Marketing', aktualisiert_am = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'standard-erinnerung-24h' AND text = 'Hallo {vorname},

kurze Erinnerung an deinen Termin. Falls etwas dazwischenkommt, buche einfach um.';

UPDATE arbeitsablaeufe SET betreff = '{vorname}, in einer Stunde geht es los', ueberschrift = 'Gleich geht es los', text = 'Hallo {vorname},

um {uhrzeit} Uhr sprechen wir uns. Wir sind vorbereitet und freuen uns auf dich.

So bist du in zehn Sekunden drin:
* Kurz vor {uhrzeit} Uhr unten auf „Zum Meeting“ klicken
* Kamera und Mikro freigeben
* That''s it.

Du kommst nicht rein oder irgendwo hakt es? Ruf uns direkt an unter **0209 36660644**, wir helfen dir sofort.

Bis gleich
Dein Team von That''s it. Marketing', aktualisiert_am = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'standard-erinnerung-1h' AND text = 'Hallo {vorname},

gleich ist es so weit. Falls etwas dazwischenkommt, buche einfach um.';

UPDATE arbeitsablaeufe SET betreff = '{vorname}, wir haben dich vermisst', ueberschrift = 'Wir haben dich vermisst', text = 'Hallo {vorname},

zu **{terminart}** am {datum} um {uhrzeit} Uhr haben wir uns leider verpasst. Kein Problem, manchmal kommt einfach etwas dazwischen.

Dein Thema ist uns trotzdem wichtig. Such dir unten einfach eine neue Zeit aus, das dauert keine Minute.

Lieber kurz telefonieren? Antworte auf diese Mail oder ruf uns an unter **0209 36660644**.

Bis bald
Dein Team von That''s it. Marketing', aktualisiert_am = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'standard-nicht-erschienen' AND text = 'Hallo {vorname},

zu deinem Termin {terminart} am {datum} haben wir uns leider verpasst. Kein Problem: Such dir einfach eine neue Zeit aus, wir freuen uns auf das Gespräch.';
