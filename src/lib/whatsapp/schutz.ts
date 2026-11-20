/**
 * Schutz des WhatsApp Bots gegen Missbrauch und Prompt Injection.
 *
 * Grundsatz: Claude bekommt nie die Kontrolle. Claude hat keine Werkzeuge, keinen Datenbankzugriff
 * und bucht nichts, der Ablauf steht im Code. Was ein Lead schreibt, ist für Claude nur Daten.
 * Bevor eine Antwort von Claude rausgeht, prüft sie dieser Code nach festen Regeln. Fällt sie
 * durch, schickt der Bot einen festen Text aus TEXTE. Ein Angreifer kann so höchstens seinen
 * eigenen Chat durcheinanderbringen, aber den Bot nichts Falsches sagen lassen.
 */

/** Höchstlängen, damit niemand den Prompt mit Text flutet (und Kosten hochtreibt). */
export const MAX_EINGANG = 1200;
export const MAX_VERLAUF_EINTRAG = 500;
export const MAX_ANTWORT = 600;

/** Nachrichten eines Leads, ab denen der Bot aufhört und das Team übernimmt. */
export const LIMIT_PRO_STUNDE = 20;
export const LIMIT_PRO_TAG = 60;
/** Obergrenze für Aufrufe von Claude über alle Chats an einem Tag (Kostenbremse). */
export const KI_TAGESLIMIT_STANDARD = 1500;
/** Sprachnachrichten über dieser Größe werden nicht umgewandelt (rund 10 Minuten). */
export const MAX_AUDIO_BYTES = 6 * 1024 * 1024;

/** Steuerzeichen und unsichtbare Zeichen raus, Länge begrenzen. */
export function saeubern(text: string | null | undefined, max: number) {
  return (text ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/g, '')
    .trim()
    .slice(0, max);
}

/**
 * Text des Leads als Datenblock für den Prompt. Spitze Klammern werden ersetzt, damit niemand
 * den Block mit einem eigenen schließenden Tag verlassen und so "Anweisungen" einschmuggeln kann.
 */
export function datenBlock(tag: string, text: string | null | undefined, max = MAX_EINGANG) {
  const sauber = saeubern(text, max).replace(/</g, '‹').replace(/>/g, '›');
  return `<${tag}>\n${sauber}\n</${tag}>`;
}

/** Namen, Firmen und Adressen aus dem Formular: nur, was nach einem Namen aussieht. */
export function namenPruefen(wert: string | null | undefined, max = 80): string | null {
  const s = saeubern(wert, max).replace(/\s+/g, ' ');
  if (!s) return null;
  if (/(https?:|www\.|\.[a-z]{2,}\/|@|[<>{}\[\]|\\`$])/i.test(s)) return null;
  // Höchstens ein paar Ziffern (etwa "Bau 24 GmbH"), keine Telefonnummern oder Codes
  if ((s.match(/\d/g)?.length ?? 0) > 6) return null;
  return s;
}

const ERLAUBTE_DOMAINS = ['thatsit.marketing', 'letsmeet.thatsit.marketing'];
const FREMDE_NAMEN = /\b(victor|mike|lina|henneberg|figueiredo|espejo)\b/i;
const VERBOTEN = [
  /\b(rabatt|nachlass|skonto|sonderpreis|sonderangebot|gutschein|geld[- ]?zur[uü]ck|garantier\w*|garantie)\b/i,
  /\b(prompt|systemprompt|system prompt|anweisungen?|instruktion|instruction|regeln? (oben|von oben)|developer|entwickler ?modus|jailbreak)\b/i,
  /\b(anthropic|openai|chatgpt|gpt|sprachmodell|language model|llm)\b/i,
  /\b(vertrag ist|hiermit (biete|best[aä]tige|garantiere)|verbindlich(es)? angebot)\b/i,
  /\b(fick|scheiß|scheiss|arschloch|idiot|hurens|wichser|nazi)\w*/i,
];

/** Erlaubte Beträge: nur der freigegebene Einstiegspreis von 5.000 €. */
function betraegeOk(text: string) {
  const betraege = text.match(/\d[\d.,]*\s?(€|eur\b|euro\b)|(€|eur\b)\s?\d[\d.,]*/gi) ?? [];
  return betraege.every((b) => b.replace(/[^\d.,]/g, '').replace(/[.,]0{1,2}$/, '').replace(/[.,]/g, '') === '5000');
}

/** Prozentangaben nur in der Bedingungsfrage ("zu 100 % überzeugt"). */
function prozentOk(text: string) {
  const werte = text.match(/\d+([.,]\d+)?\s?(%|prozent)/gi) ?? [];
  return werte.every((w) => /^100\s?(%|prozent)$/i.test(w.trim()));
}

function linksOk(text: string, extraDomains: string[]) {
  const funde = text.match(/(https?:\/\/[^\s]+|www\.[^\s]+|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(de|com|net|org|io|at|ch|eu|info|biz|app|ai|me|ly|to|xyz|link|shop|online)\b[^\s]*)/gi) ?? [];
  return funde.every((f) => {
    const host = f.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase().replace(/[.,;:!?)]+$/, '');
    return ERLAUBTE_DOMAINS.includes(host) || extraDomains.includes(host);
  });
}

/**
 * Prüft eine Antwort von Claude, bevor sie an den Lead geht.
 * Liefert den Grund, wenn sie verworfen werden muss, sonst null.
 */
export function antwortVerwerfen(text: string, lead: { vorname?: string | null; firma?: string | null; webseite?: string | null } = {}): string | null {
  if (!text) return null;
  // Eigene Angaben des Leads darf Claude nennen (Vorname, Firma, eigene Website)
  let pruef = text;
  for (const eigen of [lead.vorname, lead.firma]) if (eigen && eigen.length > 1) pruef = pruef.split(eigen).join(' ');
  const eigeneDomain = lead.webseite?.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase();
  text = pruef;
  if (text.length > MAX_ANTWORT) return 'zu lang';
  if (!betraegeOk(text)) return 'fremder Betrag';
  if (!prozentOk(text)) return 'Prozentangabe';
  if (!linksOk(text, eigeneDomain ? [eigeneDomain] : [])) return 'fremder Link';
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text)) return 'E-Mail-Adresse';
  if (/(\+|00)\d[\d\s/-]{6,}|\b0\d{2,4}[\s/-]?\d{4,}/.test(text)) return 'Telefonnummer';
  if (FREMDE_NAMEN.test(text)) return 'Name aus dem Team';
  for (const muster of VERBOTEN) if (muster.test(text)) return `verbotenes Wort (${muster.source.slice(0, 30)})`;
  if (/[<>{}]|```/.test(text)) return 'Code oder Markup';
  return null;
}
