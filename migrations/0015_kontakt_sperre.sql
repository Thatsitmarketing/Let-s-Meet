-- Ausqualifizierte Kontakte: Wer gesperrt ist, kann über die Buchungsseite und das Widget keinen Termin mehr buchen.
-- Gesetzt wird die Sperre im Backoffice (Termin: "Nicht erschienen und sperren", Kontakt: "Buchung sperren").
ALTER TABLE kontakte ADD COLUMN gesperrt INTEGER NOT NULL DEFAULT 0;
