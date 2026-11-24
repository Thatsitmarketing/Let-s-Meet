-- Tool Wechsel: benutzte Token IDs, damit ein Wechsel Token nur einmal gilt (Replay Schutz über alle Worker Instanzen).
-- Einträge sind nach höchstens 60 Sekunden wertlos und werden beim nächsten Wechsel aufgeräumt.
CREATE TABLE IF NOT EXISTS wechsel_token (
  jti TEXT PRIMARY KEY,
  ablauf INTEGER NOT NULL
);
