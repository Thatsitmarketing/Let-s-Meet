/**
 * Regeln für eingehende Nachrichten, die ohne Claude greifen müssen (Testchat 2026-11-23):
 *
 * * Abwesenheitsnotizen der WhatsApp Business App des Leads ("Vielen Dank für deine Nachricht.
 *   Ich melde mich während der Geschäftszeiten") sind keine Antwort. Der Bot ignoriert sie.
 * * Ein Knopf aus einer älteren Nachricht gehört zu einer früheren Frage, nicht zur aktuellen.
 * * Ist der Lead genervt oder versteht der Bot zweimal nicht, übernimmt ein Mensch.
 * * Freier Text bei der Zeitfrage wird gelesen, statt still "Noch offen" anzunehmen.
 *
 * Ohne Abhängigkeiten, damit `pnpm test` es direkt prüfen kann (tests/eingang.test.ts).
 */

const klein = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[,;:]+/g, ' ').replace(/\s+/g, ' ').trim();

const AUTO_STARK = [
  /automatische? (generierte )?(antwort|nachricht)/,
  /\b(auto[- ]?reply|automatic reply|out of (the )?office|abwesenheitsnotiz)\b/,
  /(au(ß|ss)erhalb|w(ä|ae)hrend) (der|unserer|meiner|unseren|meinen) (gesch(ä|ae)fts|(ö|oe)ffnungs|arbeits|b(ü|ue)ro|sprech)zeiten/,
  /(ich bin|wir sind) (derzeit|zurzeit|aktuell|momentan|gerade) (nicht erreichbar|abwesend|im urlaub|nicht im b(ü|ue)ro)/,
];
const DANKE_FUER_NACHRICHT = /(vielen |herzlichen |lieben )?danke? (dir |ihnen |euch )?f(ü|ue)r (deine|ihre|eure|die|ihr|dein) (nachricht|anfrage|e-?mail|interesse)|thanks? (you )?for (your|the) message/;
const MELDE_MICH = /(melde|melden) (mich|uns)|(antworte|antworten) (dir|ihnen|euch|so bald|schnellstm(ö|oe)glich|zeitnah)|(so bald|schnellstm(ö|oe)glich) wie m(ö|oe)glich|(wie|womit) (kann|k(ö|oe)nnen) (ich|wir) (dir|ihnen|euch) helfen|get back to you/;

/** Abwesenheitsnotiz oder Begrüßung aus der WhatsApp Business App des Leads, keine echte Antwort. */
export function istAutoAntwort(text: string) {
  const t = klein(text);
  if (!t || t.length > 600) return false;
  if (AUTO_STARK.some((r) => r.test(t))) return true;
  return DANKE_FUER_NACHRICHT.test(t) && MELDE_MICH.test(t);
}

/** Ärger über den Chat selbst: gilt in jedem Schritt */
const GENERVT_CHAT = [
  /versteh(st|t|en sie)? (du |ihr |sie )?(mich |das |es )?(denn )?(eigentlich )?(gar |(ü|ue)berhaupt )?nicht/,
  /(liest|h(ö|oe)rst) (du|ihr) (mir )?(eigentlich |(ü|ue)berhaupt |auch )*(nicht|zu\b|mit\b|richtig|was ich)/,
  /(komplett|v(ö|oe)llig|total|voll) (falsch|daneben|am thema vorbei)/,
  /\b(wtf|epic fail|was soll (das|der quatsch|der mist))\b/,
  /\b(das|der chat|der bot|du) (ist|bist) (ja |doch |echt |wirklich |komplett |total |voll )*(ein )?(fail|katastroph\w*|l(ä|ae)cherlich|sinnlos|nutzlos|unbrauchbar|bescheuert|nervig|schlecht|mist|schrott)\b/,
];
/** Ärgerwörter: bei Knopffragen ein klares Signal, bei freien Antworten oft nur die Beschreibung der alten Website */
const GENERVT_WORT = [
  /\b(fail|katastroph\w*|l(ä|ae)cherlich|peinlich|sinnlos|nutzlos|unbrauchbar|bescheuert|nervig|nervt|nervst|schwachsinn|bl(ö|oe)dsinn|quatsch|unsinn|mist)\b/,
  /\b(schei(ß|ss)\w*|kacke|dumm\w*|bl(ö|oe)d\w*)\b/,
];

/**
 * Ärger, Beschwerde über den Chat oder "du verstehst mich nicht": ab hier übernimmt ein Mensch.
 * `nurChat` für Schritte mit freier Antwort ("unsere Website ist eine Katastrophe" ist dort eine Antwort).
 */
export function istGenervt(text: string, nurChat = false) {
  const t = klein(text);
  if (!t) return false;
  return GENERVT_CHAT.some((r) => r.test(t)) || (!nurChat && GENERVT_WORT.some((r) => r.test(t)));
}

const KORREKTUR = [
  /(das|es) (hab|habe) ich (doch )?(gar )?nicht (gesagt|geschrieben|gemeint|getippt|gew(ä|ae)hlt)/,
  /hab(e)? (doch )?(etwas|was) (ganz )?anderes (getippt|geschrieben|gesagt|gemeint|gew(ä|ae)hlt|gedr(ü|ue)ckt|angeklickt)/,
  /(willst|m(ö|oe)chtest|wollt) (du|ihr) (denn )?(gar )?nicht wissen/,
];

/**
 * Der Lead korrigiert den Bot oder will eine frühere Antwort ergänzen ("ich habe etwas anderes
 * getippt, willst du nicht wissen, was mich stört?"). Der Bot fragt dann genau danach.
 */
export function istKorrektur(text: string) {
  const t = klein(text);
  return Boolean(t) && KORREKTUR.some((r) => r.test(t));
}

/** Zeitpunkt aus freiem Text, wenn er eindeutig ist. Sonst null (dann wird nachgefragt, nicht geraten). */
export function zeitpunktAusText(text: string): 'sofort' | 'bald' | 'offen' | null {
  const t = klein(text);
  if (!t || t.includes('?')) return null;
  if (/\b(asap|sofort|so schnell|schnellstm(ö|oe)glich|m(ö|oe)glichst (schnell|bald|zeitnah)|zeitnah|eilig|dringend)\b/.test(t)) return 'sofort';
  if (/\b(\d+ ?(bis|-) ?\d+ monat\w*|\d+ monat\w*|monat\w*|n(ä|ae)chste[nr]? (monat|quartal)|quartal|wochen|sommer|fr(ü|ue)hjahr|fr(ü|ue)hling|herbst|winter|anfang|mitte|ende (des )?jahres|n(ä|ae)chstes jahr|januar|februar|m(ä|ae)rz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/.test(t)) return 'bald';
  if (/\b(noch offen|offen|wei(ß|ss) (ich )?(noch )?nicht|keine ahnung|mal (sehen|schauen)|egal|unklar|kein(en)? (stress|zeitdruck|druck)|irgendwann|sp(ä|ae)ter)\b/.test(t)) return 'offen';
  return null;
}

/** Haltung zum Budget aus freiem Text, nur für eindeutige kurze Antworten (ohne Claude). */
export function budgetAusText(text: string): 'offen' | 'unsicher' | 'nein' | null {
  const t = klein(text).replace(/[.!🙂😊👍]+$/u, '').trim();
  if (!t || t.includes('?')) return null;
  if (/\b(zu teuer|zu viel|zu hoch|kein budget|nicht drin|nicht leisten|viel zu|nein|n(ö|oe)|eher nicht|leider nicht)\b/.test(t)) return 'nein';
  if (/\b(kommt (drauf|darauf) an|vielleicht|eventuell|evtl|mal sehen|mal schauen|wei(ß|ss) (ich )?nicht|unsicher|schwer zu sagen)\b/.test(t)) return 'unsicher';
  if (/^(ja|jo|jap|jep|klar|passt|okay|ok|gerne?|sicher|absolut|definitiv|auf jeden fall|das passt|ja,? (das )?passt|ja klar|ja gerne?)\b/.test(t)) return 'offen';
  return null;
}

/** Zu welchem Schritt gehört ein Knopf? Die IDs stehen in bot.ts (frageSenden) und bei den Vorlagen. */
export function knopfSchritt(knopf: string): string | null {
  const praefix = knopf.split('_')[0];
  return (
    {
      p: 'problem',
      n: 'problem',
      w: 'website_frage',
      z: 'zeitpunkt',
      b: 'budget',
      e: 'einwand',
      t: 'termin',
      d: 'entscheider',
      f: 'briefing',
    } as Record<string, string>
  )[praefix] ?? null;
}

/** Reihenfolge der Schritte bis zur Budgetfrage, für Knöpfe aus älteren Nachrichten. */
export const FRUEHE_SCHRITTE = ['kennenlernen', 'website_frage', 'start', 'problem', 'problem_text', 'ziel', 'zeitpunkt', 'budget', 'einwand'] as const;

/** Gehört der Knopf zum aktuellen Schritt? (Wunschzeit nimmt auch Terminknöpfe, Start auch Problemknöpfe.) */
export function knopfPasst(knopf: string, schritt: string) {
  const ziel = knopfSchritt(knopf);
  if (!ziel) return false;
  if (ziel === schritt) return true;
  if (ziel === 'problem' && (schritt === 'start' || schritt === 'problem')) return true;
  if (ziel === 'termin' && schritt === 'wunschzeit') return true;
  return false;
}
