/**
 * Tests der Regeln für eingehende WhatsApp Nachrichten (src/lib/whatsapp/eingang.ts).
 * Grundlage ist der Testchat vom 2026-11-23: Abwesenheitsnotiz als Antwort gewertet, alter Knopf
 * als Antwort auf die nächste Frage, Rückfrage übergangen, Ärger mit "nicht verstanden" beantwortet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetAusText, istAutoAntwort, istGenervt, istKorrektur, knopfPasst, knopfSchritt, zeitpunktAusText } from '../src/lib/whatsapp/eingang.ts';

const AUS_DEM_TEST = 'Hey ✌🏽 \nVielen Dank für deine Nachricht. Ich werde mich während der Geschäftszeiten bei dir melden.\n\nLiebe Grüße \nVictor';

test('Abwesenheitsnotizen der WhatsApp Business App werden erkannt', () => {
  for (const t of [
    AUS_DEM_TEST,
    'Vielen Dank für Ihre Nachricht! Wir melden uns schnellstmöglich bei Ihnen.',
    'Hallo und danke für deine Nachricht 😊 Wie können wir dir helfen?',
    'Wir sind derzeit nicht erreichbar. Unsere Öffnungszeiten: Mo bis Fr 8 bis 17 Uhr.',
    'Dies ist eine automatische Antwort.',
    'Thanks for your message, we will get back to you soon.',
    'Außerhalb unserer Geschäftszeiten antworten wir am nächsten Werktag.',
  ]) assert.ok(istAutoAntwort(t), t);
});

test('echte Antworten gelten nicht als Abwesenheitsnotiz', () => {
  for (const t of [
    'Etwas anderes',
    'Die Seite ist total veraltet und auf dem Handy kaum bedienbar',
    'Danke dir! Mehr Anfragen wären super',
    'Ich habe etwas anderes getippt willst du nicht wissen was mich genau stört ?',
    'Ich melde mich nächste Woche nochmal',
  ]) assert.equal(istAutoAntwort(t), false, t);
});

test('Ärger über den Chat führt zum Menschen, Beschreibungen der alten Website nicht', () => {
  assert.ok(istGenervt('Das ist ja komplett fail'));
  assert.ok(istGenervt('Verstehst du mich nicht?'));
  assert.ok(istGenervt('Liest du überhaupt, was ich schreibe?'));
  assert.ok(istGenervt('Das ist ja komplett fail', true), 'auch bei freier Antwort');
  assert.ok(istGenervt('Der Bot ist echt lächerlich', true));
  // bei freien Antworten (Was stört?) ist das eine Beschreibung, kein Ärger über uns
  assert.equal(istGenervt('Unsere Website ist eine Katastrophe', true), false);
  assert.equal(istGenervt('Die Seite nervt, weil sie so langsam ist', true), false);
  assert.equal(istGenervt('In 1 bis 3 Monaten'), false);
  assert.equal(istGenervt('Ja, das passt'), false);
});

test('Korrektur einer früheren Antwort wird erkannt', () => {
  assert.ok(istKorrektur('Ich habe etwas anderes getippt willst du nicht wissen was mich genau stört ?'));
  assert.ok(istKorrektur('Das habe ich nicht gemeint'));
  assert.equal(istKorrektur('Mehr Anfragen über Google'), false);
});

test('Zeitpunkt aus freiem Text nur, wenn er eindeutig ist', () => {
  assert.equal(zeitpunktAusText('So schnell wie möglich'), 'sofort');
  assert.equal(zeitpunktAusText('asap'), 'sofort');
  assert.equal(zeitpunktAusText('in 2 Monaten'), 'bald');
  assert.equal(zeitpunktAusText('Im Frühjahr'), 'bald');
  assert.equal(zeitpunktAusText('Weiß ich noch nicht'), 'offen');
  // die Rückfrage aus dem Testchat darf nicht still zu "Noch offen" werden
  assert.equal(zeitpunktAusText('Ich habe etwas anderes getippt willst du nicht wissen was mich genau stört ?'), null);
  assert.equal(zeitpunktAusText('Etwas anderes'), null);
});

test('Budget aus freiem Text nur bei klaren Antworten', () => {
  assert.equal(budgetAusText('Ja passt'), 'offen');
  assert.equal(budgetAusText('Zu teuer für uns'), 'nein');
  assert.equal(budgetAusText('Kommt drauf an'), 'unsicher');
  assert.equal(budgetAusText('Das ist ja komplett fail'), null);
  assert.equal(budgetAusText('Was kostet denn der Entwurf?'), null);
});

test('Knöpfe gehören zu ihrem Schritt, ein alter Knopf passt nicht zur nächsten Frage', () => {
  assert.equal(knopfSchritt('p_anderes'), 'problem');
  assert.ok(knopfPasst('p_anderes', 'problem'));
  assert.ok(knopfPasst('p_veraltet', 'start'));
  assert.equal(knopfPasst('p_anderes', 'ziel'), false, 'Knopf aus der Vorlage, während schon nach dem Ziel gefragt wird');
  assert.equal(knopfPasst('z_offen', 'budget'), false);
  assert.ok(knopfPasst('t_0', 'wunschzeit'));
  assert.equal(knopfSchritt('x_unbekannt'), null);
});
