-- Antworten aus dem Formular der Playbook Landingpages (z. B. Website, Teamgröße).
-- JSON [{ "frage": "Teamgröße", "antwort": "2 bis 10" }], NULL wenn nichts beantwortet.
-- Die Fragen bestimmt die Landingpage, Let's Meet zeigt an, was ankommt.
ALTER TABLE playbook_zugaenge ADD COLUMN antworten TEXT;
