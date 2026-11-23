-- Interessenten, die selbst per WhatsApp schreiben (Knopf "Per WhatsApp weiter" auf der Dankesseite
-- und in der Mail der Landingpage Website Entwurf). Der Bot ordnet sie einer Anfrage zu,
-- über die Absendernummer oder die Anfragenummer im Text. Siehe src/lib/whatsapp/zuordnung.ts.

-- Anfragenummer aus dem Funnel (sechs Zeichen), bei Leads über /api/whatsapp/lead als Feld referenz
ALTER TABLE wa_gespraeche ADD COLUMN referenz TEXT;
-- Zugeordnete Anfrage in `anfragen`, wenn es eine gibt
ALTER TABLE wa_gespraeche ADD COLUMN anfrage_id TEXT;
-- Wie das Gespräch entstanden ist: formular (Lead mit Einwilligung), nummer (selbst geschrieben,
-- Absendernummer passt), anfragenummer (selbst geschrieben, Nummer im Text), keine (nicht zugeordnet)
ALTER TABLE wa_gespraeche ADD COLUMN zuordnung TEXT NOT NULL DEFAULT 'formular';

CREATE INDEX IF NOT EXISTS wa_gespraeche_referenz ON wa_gespraeche (referenz);

-- Anfrage wurde per WhatsApp vom Bot übernommen: niemand muss mehr anrufen
ALTER TABLE anfragen ADD COLUMN whatsapp_gespraech_id TEXT;
ALTER TABLE anfragen ADD COLUMN whatsapp_am TEXT;
