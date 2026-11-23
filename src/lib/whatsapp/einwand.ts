/**
 * Textwahl der Einwandbehandlung beim Budget (höchstens zwei Anläufe).
 *
 * Ohne Claude, bei einer verworfenen Antwort oder wenn Claude sich wiederholt, kam früher
 * in beiden Anläufen derselbe feste Text. Jetzt hat jeder Anlauf einen eigenen Ersatztext
 * mit anderem Blickwinkel, und keine Antwort geht raus, die einer der letzten Nachrichten
 * des Bots gleicht. Ohne Abhängigkeiten, damit `pnpm test` es direkt prüfen kann.
 */

/** Feste Texte je Anlauf: 1 Wert eines Kunden, 2 kein Risiko durch den kostenlosen Entwurf. */
export const EINWAND_ERSATZ = [
  'Verstehe ich gut. Lass mich kurz fragen: Was ist ein neuer Kunde für euch wert? Oft machen schon zwei, drei zusätzliche Kunden im Jahr die Website bezahlt. Wenn dich der Entwurf zu 100 % überzeugt und du siehst, was er bringt, wäre das dann grundsätzlich drin?',
  'Total verständlich, eine neue Website ist eine echte Investition. Genau deshalb gibt es zuerst den Entwurf: Der kostet dich nichts, und im Gespräch siehst du schwarz auf weiß, wie eure Website aussehen würde und was sie euch bringen kann. Danach entscheidest du ganz in Ruhe, ohne jede Verpflichtung. Magst du dir das unverbindlich anschauen?',
] as const;

/** Text ohne angehängte Knöpfe ("\n[A | B]"), klein, nur Buchstaben und Ziffern. */
export function normalisiert(text: string) {
  return text
    .replace(/\n\[[^\]]*\]\s*$/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Gleich oder fast gleich: gleicher Text, einer steckt im anderen oder mindestens 60 Prozent gemeinsame Wörter. */
export function zuAehnlich(a: string, b: string) {
  const x = normalisiert(a);
  const y = normalisiert(b);
  if (!x || !y) return false;
  if (x === y || (x.length > 40 && y.includes(x)) || (y.length > 40 && x.includes(y))) return true;
  const wa = new Set(x.split(' ').filter((w) => w.length > 2));
  const wb = new Set(y.split(' ').filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return false;
  let gemeinsam = 0;
  for (const w of wa) if (wb.has(w)) gemeinsam++;
  return gemeinsam / Math.min(wa.size, wb.size) >= 0.6;
}

/**
 * Antwort für Anlauf `versuch` (1 oder 2). Reihenfolge: Vorschlag von Claude, Ersatztext dieses
 * Anlaufs, der andere Ersatztext. Genommen wird der erste, der keiner bisherigen Nachricht gleicht.
 */
export function einwandAntwort(vorschlag: string | null | undefined, bisher: string[], versuch: number) {
  const eigener = EINWAND_ERSATZ[Math.min(Math.max(versuch, 1), EINWAND_ERSATZ.length) - 1];
  const kandidaten = [vorschlag?.trim() ?? '', eigener, ...EINWAND_ERSATZ].filter(Boolean);
  return kandidaten.find((k) => !bisher.some((b) => zuAehnlich(k, b))) ?? eigener;
}
