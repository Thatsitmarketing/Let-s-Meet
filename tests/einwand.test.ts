/**
 * Tests der Einwandbehandlung beim Budget (src/lib/whatsapp/einwand.ts): der zweite Anlauf darf
 * nie dieselbe Antwort wie der erste sein, auch ohne Claude oder wenn Claude sich wiederholt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EINWAND_ERSATZ, einwandAntwort, zuAehnlich } from '../src/lib/whatsapp/einwand.ts';

const KNOEPFE = '\n[Ja, dann schon | Eher nicht]';
const BUDGET = 'Danke dir! Kurz zum Ablauf: Wir erstellen dir den Entwurf kostenlos …\n[Ja, das passt | Kommt drauf an | Eher zu viel]';

test('ohne Claude: erster Anlauf Wert eines Kunden, zweiter Anlauf anderer Text', () => {
  const erster = einwandAntwort(null, [BUDGET], 1);
  assert.equal(erster, EINWAND_ERSATZ[0]);
  const zweiter = einwandAntwort(null, [erster + KNOEPFE, BUDGET], 2);
  assert.equal(zweiter, EINWAND_ERSATZ[1]);
  assert.notEqual(zweiter, erster);
});

test('Claude wiederholt im zweiten Anlauf seine erste Antwort: Ersatztext statt Wiederholung', () => {
  const claude = 'Verstehe ich. Was bringt euch ein neuer Kunde im Schnitt? Wenn der Entwurf passt, wäre das dann drin?';
  const erster = einwandAntwort(claude, [BUDGET], 1);
  assert.equal(erster, claude);
  const zweiter = einwandAntwort(claude, [erster + KNOEPFE, BUDGET], 2);
  assert.equal(zweiter, EINWAND_ERSATZ[1]);
});

test('Claude formuliert fast gleich (nur Satzzeichen und ein Wort anders): gilt als Wiederholung', () => {
  const a = 'Verstehe ich gut. Was ist ein neuer Kunde für euch wert? Oft machen zwei, drei Kunden die Website bezahlt. Wäre das drin?';
  const b = 'Verstehe ich gut! Was ist ein neuer Kunde für euch wert? Oft machen schon zwei, drei Kunden die Website bezahlt. Wäre das dann drin?';
  assert.ok(zuAehnlich(a, b + KNOEPFE));
});

test('neue Antwort von Claude im zweiten Anlauf geht durch', () => {
  const zweiterClaude = 'Absolut nachvollziehbar. Der Entwurf kostet dich nichts, du entscheidest erst danach. Magst du ihn dir anschauen?';
  const zweiter = einwandAntwort(zweiterClaude, [EINWAND_ERSATZ[0] + KNOEPFE, BUDGET], 2);
  assert.equal(zweiter, zweiterClaude);
});

test('erster Anlauf ohne Claude, zweiter Anlauf mit Claude, der den Ersatztext wiederholt', () => {
  const zweiter = einwandAntwort(EINWAND_ERSATZ[0], [EINWAND_ERSATZ[0] + KNOEPFE], 2);
  assert.equal(zweiter, EINWAND_ERSATZ[1]);
});

test('die beiden Ersatztexte gelten nicht als ähnlich, der Budgettext auch nicht', () => {
  assert.equal(zuAehnlich(EINWAND_ERSATZ[0], EINWAND_ERSATZ[1]), false);
  assert.equal(zuAehnlich(EINWAND_ERSATZ[0], BUDGET), false);
  assert.equal(zuAehnlich(EINWAND_ERSATZ[1], BUDGET), false);
});
