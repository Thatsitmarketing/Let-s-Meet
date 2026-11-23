/**
 * WhatsApp Bot für die Leads der Landingpage "Kostenloser Website-Entwurf".
 *
 * Ablauf (fest im Code, Texte unten in TEXTE):
 *   1. Vorlage mit Knöpfen: was stört an der Website (ohne Website: wie kommen Kunden zu euch)
 *   2. Ziel der neuen Website (freier Text)
 *   3. Zeitpunkt (Knöpfe)
 *   4. Ablauf und Budget ab 5.000 € (Knöpfe), bei Zögern Einwandbehandlung über Claude, höchstens zwei Anläufe
 *   5. Termin: zwei Vorschläge an verschiedenen Tagen oder Wunschzeit, gebucht über Let's Meet (Google Meet)
 *   6. Entscheider, 7. Website, die gefällt (Briefing), danach fertig
 *
 * Claude liest nur freie Antworten ein und schreibt Spiegelung, Rückfragen und Einwandbehandlung (ki.ts).
 * Schreibt das Team aus der WhatsApp Business App in einen Chat, pausiert der Bot dort (Status "mensch").
 * "Stopp" meldet ab. Unbekannte Nummern ignoriert der Bot: über die Firmennummer laufen auch ganz
 * normale Kundenchats. Ausnahme (seit 2026-11-23): schreibt ein Interessent der Landingpage selbst
 * zuerst, ordnet der Bot ihn über Absendernummer oder Anfragenummer einer Anfrage zu und startet
 * das Setting ohne Vorlage (selbstGeschrieben, Zuordnung in zuordnung.ts).
 */
import { env } from 'cloudflare:workers';
import { alle, ausfuehren, eins, jetztIso, neueId } from '../db';
import { basisUrl, buchungAnlegen, SlotVergeben } from '../buchungen';
import { buchungNachId, buero } from '../abfragen';
import { mailArbeitsablauf, mailSenden } from '../mail';
import { slotFrei } from '../slots';
import { datumInZone, teileInZone } from '../zeit';
import { kiAktiv, kiVerstehen, type KiErgebnis } from './ki';
import { gelesenUndTippt, sendeKnoepfe, sendeVorlage, type Knopf } from './meta';
import { botTerminart, slotKurz, slotLang, tagLang, vorschlaegeZumWunsch, zweiVorschlaege } from './termine';
import { KI_TAGESLIMIT_STANDARD, LIMIT_PRO_STUNDE, LIMIT_PRO_TAG, MAX_EINGANG, namenPruefen, saeubern } from './schutz';
import { angabenDerAnfrage, anfrageZuordnen, anfrageZurAnfragenummer, anfragenummerAusText, type AnfrageTreffer } from './zuordnung';
import { crmMelden } from '../crm';
import { EINWAND_ERSATZ, einwandAntwort } from './einwand';
import { emailGueltig } from '../eingabe';

const TZ = 'Europe/Berlin';

export interface Gespraech {
  id: string;
  telefon: string;
  name: string;
  vorname: string;
  firma: string | null;
  webseite: string | null;
  email: string | null;
  hat_website: number;
  quelle: string | null;
  hinweise: string | null;
  schritt: string;
  status: 'offen' | 'gebucht' | 'verabschiedet' | 'anrufen' | 'mensch' | 'abgemeldet';
  heiss: number;
  problem: string | null;
  ziel: string | null;
  zeitpunkt: string | null;
  budget: string | null;
  einwand_versuche: number;
  entscheider: string | null;
  briefing: string | null;
  angebotene_slots: string | null;
  buchung_id: string | null;
  start_faellig_am: string | null;
  start_gesendet_am: string | null;
  letzte_eingang_am: string | null;
  letzte_ausgang_am: string | null;
  nachfass_stufe: number;
  team_informiert_am: string | null;
  erinnerung_gesendet: number;
  in_arbeit_bis: string | null;
  fehler: string | null;
  /** Anfragenummer aus dem Funnel (sechs Zeichen) */
  referenz: string | null;
  anfrage_id: string | null;
  /** formular (Lead mit Einwilligung), nummer und anfragenummer (selbst geschrieben, zugeordnet), keine (nicht zugeordnet) */
  zuordnung: 'formular' | 'nummer' | 'anfragenummer' | 'keine';
  erstellt_am: string;
  aktualisiert_am: string;
}

export interface WaNachricht {
  id: string;
  gespraech_id: string;
  richtung: 'ein' | 'aus' | 'team';
  art: string;
  text: string;
  wert: string | null;
  wa_message_id: string | null;
  verarbeitet: number;
  erstellt_am: string;
}

/* ---------- Texte und Vorlagen ---------- */

/** Namen der Vorlagen bei Meta. Die Texte müssen dort genau so eingereicht werden (docs/whatsapp-bot.md). */
export const VORLAGEN = {
  startWebsite: { name: 'entwurf_start_website', knoepfe: ['p_veraltet', 'p_anfragen', 'p_anderes'] },
  startOhne: { name: 'entwurf_start_ohne_website', knoepfe: ['p_empfehlungen', 'p_social', 'p_anderes'] },
  nachfass: { name: 'entwurf_nachfass', knoepfe: ['n_los', 'n_spaeter'] },
  erinnerung: { name: 'termin_erinnerung', knoepfe: [] as string[] },
} as const;

const PROBLEM_WEBSITE: Record<string, string> = { veraltet: 'Wirkt veraltet', anfragen: 'Bringt kaum Anfragen', anderes: 'Etwas anderes' };
const PROBLEM_OHNE: Record<string, string> = { empfehlungen: 'Über Empfehlungen', social: 'Über Social Media', anderes: 'Anders' };
const ZEITPUNKT: Record<string, string> = { sofort: 'So schnell es geht', bald: 'In 1 bis 3 Monaten', offen: 'Noch offen' };

export const TEXTE = {
  startWebsite: (v: string, firma: string) =>
    `Hi ${v}, hier ist das Team von That's it. Marketing 👋 Danke für deine Anfrage zum kostenlosen Website-Entwurf für ${firma}! Damit wir den Entwurf genau auf euch zuschneiden: Was stört dich an eurer jetzigen Website am meisten?`,
  startOhne: (v: string, firma: string) =>
    `Hi ${v}, hier ist das Team von That's it. Marketing 👋 Danke für deine Anfrage zum kostenlosen Website-Entwurf für ${firma}! Damit wir den Entwurf genau auf euch zuschneiden: Wie kommen eure Kunden aktuell auf euch?`,
  nachfass: (v: string) =>
    `Hi ${v}, kurze Erinnerung an deinen kostenlosen Website-Entwurf 🙂 Damit wir starten können, brauchen wir nur zwei, drei kurze Antworten von dir. Passt es gerade?`,
  erinnerung: (v: string, wann: string) =>
    `Hi ${v}, kurze Erinnerung: Morgen, ${wann}, stellt dir Tim deinen Website-Entwurf vor. Den Link zum Google Meet findest du in deiner Bestätigungsmail. Wir freuen uns auf dich!`,

  problemWebsite: 'Was stört dich an eurer jetzigen Website am meisten?',
  problemOhne: 'Wie kommen eure Kunden aktuell auf euch?',
  problemQuittung: {
    veraltet: 'Verstehe, das hören wir oft. Genau da setzt der Entwurf an.',
    anfragen: 'Verstehe, dann ist die Website gerade eher Visitenkarte als Vertriebskanal. Genau da setzt der Entwurf an.',
    empfehlungen: 'Super, Empfehlungen sind Gold wert. Wer euch empfohlen bekommt, googelt euch aber meistens trotzdem zuerst.',
    social: 'Stark, dann kennen euch schon einige. Eine eigene Website macht daraus Anfragen.',
  } as Record<string, string>,
  problemText: 'Erzähl mir kurz, was dich stört. Ein, zwei Sätze reichen völlig 🙂',
  problemTextOhne: 'Erzähl mir kurz, wie die Kunden zu euch finden. Ein, zwei Sätze reichen völlig 🙂',
  ziel: 'Und was soll die neue Website für euch erreichen? Zum Beispiel mehr Anfragen, mehr Bewerber oder einfach ein moderner Auftritt.',
  zeitpunkt: 'Wann möchtet ihr mit der neuen Website starten?',
  budget:
    'Danke dir! Kurz zum Ablauf: Wir erstellen dir den Entwurf kostenlos und Tim, unser Geschäftsführer, stellt ihn dir in einem Strategiegespräch von 60 Minuten vor. Wenn er dich überzeugt, setzen wir die komplette Website für euch um.\n\nDamit du es einordnen kannst: Unsere Websites starten ab 5.000 €, weil wir sie individuell bauen, mit Struktur, Texten und Technik. Über 350 Unternehmen haben wir so schon begleitet. Wäre das ein Rahmen, der für euch passt, wenn dich der Entwurf überzeugt?',
  einwandErsatz: EINWAND_ERSATZ[0],
  verabschiedung: (v: string, firma: string) =>
    `Danke dir für die ehrliche Antwort${v ? `, ${v}` : ''}! Dann ist der Entwurf gerade vermutlich nicht der richtige Schritt für euch, und wir möchten dir nicht unnötig Zeit stehlen. Falls sich bei euch etwas ändert, schreib uns einfach hier, wir sind gern für dich da. Alles Gute für dich und ${firma}!`,
  termin: (zuerst: string) =>
    `${zuerst}Dann lass uns den Termin festmachen, in dem dir Tim den Entwurf vorstellt. 60 Minuten per Google Meet, auf Wunsch auch bei uns im Büro in Gelsenkirchen. Welcher Termin passt dir?`,
  wunschzeit: 'Klar! Wann passt es dir am besten? Schreib mir einfach Tag und ungefähre Uhrzeit, zum Beispiel „Donnerstag nachmittags“.',
  keinTermin: 'Ich kläre das kurz mit dem Team, wir melden uns heute noch mit einem Terminvorschlag bei dir.',
  slotWeg: 'Oh, der Termin ist gerade eben weggegangen. Hier sind neue Vorschläge:',
  gebucht: (wann: string, email: string | null) =>
    `Perfekt, dann ist ${wann} für dich eingetragen 🙌 Die Bestätigung mit dem Google Meet Link kommt gleich per Mail${email ? ` an ${email}` : ''}.`,
  entscheider: 'Kurze Frage noch: Entscheidest du das Thema Website allein, oder ist noch jemand mit dabei?',
  entscheiderText: 'Super, bring die Person gern mit! Leite die Einladung aus deiner Mail einfach weiter. Wer ist es denn, damit Tim Bescheid weiß?',
  briefing:
    'Letzte Frage, damit der Entwurf richtig gut wird: Gibt es eine Website, die dir richtig gut gefällt? Schick mir einfach den Link. Wenn dir keine einfällt, ist das auch völlig okay.',
  fertig: (v: string, wann: string) => `Danke dir${v ? `, ${v}` : ''}! Dann legen wir mit deinem Entwurf los. Wir sehen uns ${wann} 🙌`,
  abgemeldet: 'Alles klar, wir schreiben dir hier nicht mehr. Falls du doch Fragen hast, melde dich jederzeit.',
  mensch: 'Klar, ich gebe das direkt ans Team weiter, wir melden uns zeitnah bei dir.',
  spaeter: 'Alles klar, kein Stress. Schreib mir einfach, wenn es dir besser passt 🙂',
  nachhaken: (v: string) => `Kurz nachgehakt${v ? `, ${v}` : ''} 🙂`,
  umbuchen: (link: string) => `Kein Problem! Hier kannst du den Termin selbst verschieben oder absagen: ${link}`,
  unverstanden: 'Das habe ich nicht ganz verstanden.',

  // Interessent schreibt selbst zuerst (Knopf "Per WhatsApp weiter" der Landingpage), keine Vorlage nötig
  selbstStart: (v: string, firma: string) =>
    `Hi ${v}, schön, dass du dich meldest 👋 Hier ist das Team von That's it. Marketing. Danke für deine Anfrage zum kostenlosen Website-Entwurf für ${firma}! Damit wir den Entwurf genau auf euch zuschneiden, habe ich ein paar kurze Fragen.`,
  kennenlernen:
    "Hi, schön, dass du dich meldest 👋 Hier ist das Team von That's it. Marketing. Damit ich deine Anfrage zum kostenlosen Website-Entwurf zuordnen kann: Wie heißt du und für welche Firma ist der Entwurf?",
  kennenlernenNochmal: 'Magst du mir kurz deinen Namen und den Namen eurer Firma schreiben? Zum Beispiel „Lisa Becker, Becker Bau“.',
  websiteFrage: (v: string) => `Danke dir${v ? `, ${v}` : ''}! Habt ihr schon eine eigene Website?`,
  email: 'Fast geschafft! An welche E-Mail-Adresse dürfen wir dir die Bestätigung mit dem Google Meet Link schicken?',
  emailUngueltig: 'Die Adresse sieht nicht ganz vollständig aus. Schreib sie mir bitte noch einmal, zum Beispiel name@firma.de.',
};

const STOPP = /^(stop+|stopp+|abmelden|abbestellen|keine nachrichten( mehr)?|bitte nicht mehr schreiben)[.!]*$/i;

/* ---------- Hilfen ---------- */

const jetzt = () => new Date();
const vorname = (name: string) => name.trim().split(/\s+/)[0] || name;
const firmaText = (g: Gespraech) => g.firma?.trim() || 'euch';
const slotsLesen = (g: Gespraech): string[] => {
  try {
    return JSON.parse(g.angebotene_slots || '[]');
  } catch {
    return [];
  }
};

/** Wochentags von 8 bis 21 Uhr, am Wochenende von 10 bis 20 Uhr, keine Nachrichten in der Nacht. */
export function darfSchreiben(zeit = jetzt()) {
  const t = teileInZone(zeit, TZ);
  const wochenende = t.wochentag === 0 || t.wochentag === 6;
  return wochenende ? t.stunde >= 10 && t.stunde < 20 : t.stunde >= 8 && t.stunde < 21;
}

/** Nächster erlaubter Zeitpunkt in UTC, in 15 Minuten Schritten gesucht. */
function naechsteSchreibzeit(zeit = jetzt()) {
  let t = zeit.getTime();
  for (let i = 0; i < 4 * 48 && !darfSchreiben(new Date(t)); i++) t += 15 * 60_000;
  return new Date(t);
}

async function gespraech(id: string) {
  return eins<Gespraech>('SELECT * FROM wa_gespraeche WHERE id = ?', id);
}

async function setzen(id: string, felder: Partial<Record<keyof Gespraech, string | number | null>>) {
  const schluessel = Object.keys(felder);
  if (!schluessel.length) return;
  await ausfuehren(
    `UPDATE wa_gespraeche SET ${schluessel.map((s) => `${s} = ?`).join(', ')}, aktualisiert_am = ? WHERE id = ?`,
    ...schluessel.map((s) => (felder as Record<string, string | number | null>)[s]),
    jetztIso(),
    id,
  );
}

async function protokoll(g: Gespraech, richtung: WaNachricht['richtung'], art: string, text: string, waId: string | null, wert: string | null = null, verarbeitet = 1) {
  const res = await ausfuehren(
    `INSERT OR IGNORE INTO wa_nachrichten (id, gespraech_id, richtung, art, text, wert, wa_message_id, verarbeitet, erstellt_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    neueId(), g.id, richtung, art, text, wert, waId, verarbeitet, jetztIso(),
  );
  return (res.meta?.changes ?? 0) > 0;
}

/** Senden mit Protokoll. Fehler landen am Gespräch und beim Team, der Bot bleibt stehen. */
async function schreiben(g: Gespraech, text: string, knoepfe: Knopf[] = []) {
  try {
    const waId = await sendeKnoepfe(g.telefon, text, knoepfe);
    const anzeige = knoepfe.length ? `${text}\n[${knoepfe.map((k) => k.titel).join(' | ')}]` : text;
    await protokoll(g, 'aus', knoepfe.length ? 'knopf' : 'text', anzeige, waId);
    await setzen(g.id, { letzte_ausgang_am: jetztIso(), fehler: null });
  } catch (fehler) {
    await fehlerMelden(g, fehler);
    throw fehler;
  }
}

async function vorlage(g: Gespraech, name: string, parameter: string[], knoepfe: readonly string[], anzeige: string) {
  try {
    const waId = await sendeVorlage(g.telefon, name, parameter, [...knoepfe]);
    await protokoll(g, 'aus', 'vorlage', anzeige, waId);
    await setzen(g.id, { letzte_ausgang_am: jetztIso(), fehler: null });
    return true;
  } catch (fehler) {
    await fehlerMelden(g, fehler);
    return false;
  }
}

async function fehlerMelden(g: Gespraech, fehler: unknown) {
  const text = String((fehler as Error)?.message ?? fehler).slice(0, 500);
  console.error('WhatsApp Bot', g.id, text);
  await setzen(g.id, { fehler: text });
  if (g.status !== 'anrufen') {
    await setzen(g.id, { status: 'anrufen' });
    await teamInformieren(g, `Der WhatsApp Bot konnte nicht senden (${text}). Bitte den Lead anrufen.`);
  }
}

/** Mail ans Team mit Link auf den Chat im Backoffice. */
export async function teamInformieren(g: Gespraech, grund: string) {
  const basis = basisUrl();
  const an = env.WHATSAPP_TEAM_EMAIL?.trim() || (await buero())?.email;
  if (!an) return;
  const verlauf = await alle<WaNachricht>('SELECT * FROM wa_nachrichten WHERE gespraech_id = ? ORDER BY erstellt_am DESC LIMIT 8', g.id);
  const text = [
    grund,
    '',
    `Name: ${g.name}`,
    g.firma ? `Firma: ${g.firma}` : '',
    `Telefon: +${g.telefon}`,
    g.email ? `E-Mail: ${g.email}` : '',
    g.webseite ? `Webseite: ${g.webseite}` : '',
    g.problem ? `Problem: ${g.problem}` : '',
    g.ziel ? `Ziel: ${g.ziel}` : '',
    g.zeitpunkt ? `Zeitpunkt: ${g.zeitpunkt}` : '',
    g.budget ? `Budget: ${g.budget}` : '',
    g.hinweise ? `Hinweise: ${g.hinweise}` : '',
    verlauf.length ? `\nLetzte Nachrichten:\n${verlauf.reverse().map((n) => `${n.richtung === 'ein' ? g.vorname : n.richtung === 'team' ? 'Team' : 'Bot'}: ${n.text}`).join('\n')}` : '',
  ].filter((z) => z !== '').join('\n');
  await mailSenden({
    an,
    betreff: `WhatsApp Lead: ${g.name}${g.firma ? `, ${g.firma}` : ''}`,
    html: mailArbeitsablauf(basis, {
      vorschau: grund,
      eyebrow: 'WhatsApp Bot',
      ueberschrift: g.name,
      text,
      details: null,
      knoepfe: [{ href: `${basis}/app/whatsapp/${g.id}`, text: 'Chat ansehen', art: 'schwarz' }],
    }),
  }).catch((f) => console.error('Teammail fehlgeschlagen', f));
  await setzen(g.id, { team_informiert_am: jetztIso() });
}

/* ---------- Lead anlegen und erste Nachricht ---------- */

export interface LeadDaten {
  name: string;
  firma: string | null;
  webseite: string | null;
  telefon: string; // nur Ziffern, mit Ländervorwahl
  email: string | null;
  hatWebsite: boolean;
  hinweise: string | null;
  quelle: string | null;
  /** Anfragenummer aus dem Funnel, falls die Landingpage sie mitschickt */
  referenz?: string | null;
}

export async function leadAnlegen(d: LeadDaten, imHintergrund: (p: Promise<unknown>) => void) {
  // Wer sich abgemeldet hat, wird nie wieder angeschrieben. Ein offenes Gespräch wird nicht doppelt begonnen.
  const vorher = await eins<Gespraech>('SELECT * FROM wa_gespraeche WHERE telefon = ? ORDER BY erstellt_am DESC LIMIT 1', d.telefon);
  if (vorher?.status === 'abgemeldet') return { id: vorher.id, status: 'abgemeldet' as const };
  if (vorher && Date.now() - Date.parse(vorher.erstellt_am) < 30 * 86_400_000) return { id: vorher.id, status: 'vorhanden' as const };

  const id = neueId();
  const jetztText = jetztIso();
  const faellig = naechsteSchreibzeit().toISOString();
  // Kam die Anfrage aus dem Funnel schon an, wird sie gleich verknüpft (sonst in anfrageAnlegen)
  const anfrage = d.referenz ? await anfrageZurAnfragenummer(alle, d.referenz).catch(() => null) : null;
  await ausfuehren(
    `INSERT INTO wa_gespraeche (id, telefon, name, vorname, firma, webseite, email, hat_website, quelle, hinweise, schritt, status, start_faellig_am, referenz, anfrage_id, zuordnung, erstellt_am, aktualisiert_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'start', 'offen', ?, ?, ?, 'formular', ?, ?)`,
    id, d.telefon, d.name, vorname(d.name), d.firma, d.webseite, d.email, d.hatWebsite ? 1 : 0, d.quelle, d.hinweise, faellig,
    d.referenz ?? null, anfrage?.id ?? null, jetztText, jetztText,
  );
  if (anfrage) await ausfuehren('UPDATE anfragen SET whatsapp_gespraech_id = ?, whatsapp_am = COALESCE(whatsapp_am, ?) WHERE id = ?', id, jetztText, anfrage.id);
  if (darfSchreiben()) imHintergrund(startSenden(id));
  return { id, status: darfSchreiben() ? ('gesendet' as const) : ('geplant' as const) };
}

export async function startSenden(id: string) {
  const g = await gespraech(id);
  if (!g || g.start_gesendet_am || g.status !== 'offen') return;
  // Doppeltes Senden aus Cron und Anfrage verhindern
  const res = await ausfuehren("UPDATE wa_gespraeche SET start_gesendet_am = ? WHERE id = ? AND start_gesendet_am IS NULL", jetztIso(), id);
  if (!res.meta?.changes) return;
  const v = g.hat_website ? VORLAGEN.startWebsite : VORLAGEN.startOhne;
  const text = (g.hat_website ? TEXTE.startWebsite : TEXTE.startOhne)(g.vorname, firmaText(g));
  const knopfTitel = Object.values(g.hat_website ? PROBLEM_WEBSITE : PROBLEM_OHNE);
  const ok = await vorlage(g, v.name, [g.vorname, firmaText(g)], v.knoepfe, `${text}\n[${knopfTitel.join(' | ')}]`);
  if (ok) await setzen(id, { schritt: 'problem' });
  else await setzen(id, { start_gesendet_am: null });
}

/* ---------- Eingehende Nachrichten ---------- */

export interface Eingang {
  waId: string;
  art: 'text' | 'knopf' | 'sprache' | 'sonstiges';
  text: string;
  /** ID eines gedrückten Knopfs (Antwortknopf oder Schnellantwort einer Vorlage) */
  knopf: string | null;
}

/** Wie lange eine Nummer kein zweites Gespräch bekommt */
const DUBLETTE_TAGE = 30;

/**
 * Speichert die Nachricht eines bekannten Leads und arbeitet sie ab. Ohne Gespräch versucht der Bot,
 * den Chat einer Anfrage der Landingpage zuzuordnen (selbstGeschrieben). Sonst: null, der Bot schweigt.
 */
export async function eingangVerarbeiten(telefon: string, e: Eingang) {
  const g = await eins<Gespraech>('SELECT * FROM wa_gespraeche WHERE telefon = ? ORDER BY erstellt_am DESC LIMIT 1', telefon);
  if (!g) return selbstGeschrieben(telefon, e);
  // Altes, abgeschlossenes Gespräch (über 30 Tage) und eine neue Anfrage: neues Setting. Nach "Stopp" nie.
  if (g.status !== 'abgemeldet' && g.status !== 'offen' && Date.now() - Date.parse(g.erstellt_am) > DUBLETTE_TAGE * 86_400_000) {
    const neu = await selbstGeschrieben(telefon, e, g.erstellt_am);
    if (neu) return neu;
  }
  const aktiv = g.status === 'offen' || g.status === 'gebucht' || g.status === 'anrufen';
  const neu = await protokoll(g, 'ein', e.art, e.text, e.waId, e.knopf, aktiv ? 0 : 1);
  if (!neu) return g.id; // Meta schickt Webhooks bei Zeitüberschreitung doppelt
  await setzen(g.id, { letzte_eingang_am: jetztIso(), nachfass_stufe: 0 });

  if (g.status === 'verabschiedet') {
    await setzen(g.id, { status: 'mensch' });
    await teamInformieren(g, 'Der Lead hat sich nach der Verabschiedung wieder gemeldet. Bitte selbst übernehmen.');
    return g.id;
  }
  if (!aktiv) return g.id;
  // Missbrauch: wer den Bot mit Nachrichten flutet, bekommt keine Antworten mehr, das Team übernimmt
  const stunde = await eins<{ n: number }>("SELECT COUNT(*) AS n FROM wa_nachrichten WHERE gespraech_id = ? AND richtung = 'ein' AND erstellt_am >= ?", g.id, new Date(Date.now() - 3600_000).toISOString());
  const tag = await eins<{ n: number }>("SELECT COUNT(*) AS n FROM wa_nachrichten WHERE gespraech_id = ? AND richtung = 'ein' AND erstellt_am >= ?", g.id, new Date(Date.now() - 86400_000).toISOString());
  if ((stunde?.n ?? 0) > LIMIT_PRO_STUNDE || (tag?.n ?? 0) > LIMIT_PRO_TAG) {
    await ausfuehren("UPDATE wa_nachrichten SET verarbeitet = 1 WHERE gespraech_id = ? AND richtung = 'ein'", g.id);
    await setzen(g.id, { status: 'mensch', fehler: 'Auffällig viele Nachrichten, Bot pausiert' });
    await teamInformieren(g, 'Auffällig viele Nachrichten in kurzer Zeit. Der Bot antwortet in diesem Chat nicht mehr, bitte selbst prüfen.');
    return g.id;
  }
  if (g.status === 'anrufen' && !g.buchung_id) await setzen(g.id, { status: 'offen' });
  if (e.art !== 'knopf') await gelesenUndTippt(e.waId);
  await abarbeiten(g.id);
  return g.id;
}

/**
 * Ein Interessent schreibt selbst zuerst (Knopf "Per WhatsApp weiter" der Landingpage Website Entwurf).
 * Zuordnung über die Absendernummer, sonst über die Anfragenummer im Text (zuordnung.ts).
 * Treffer: Gespräch anlegen, Anfrage in Let's Meet und Close als übernommen markieren, Setting starten.
 * Ohne Treffer, aber erkennbar zur Landingpage: nach Name und Firma fragen, als nicht zugeordnet markieren.
 * Alles andere ist ein normaler Kundenchat: null, nichts wird gespeichert.
 * Kein Vorlagenzwang: der Kunde hat zuerst geschrieben, das Servicefenster von 24 Stunden ist offen.
 */
async function selbstGeschrieben(telefon: string, e: Eingang, nurNeuerAls: string | null = null): Promise<string | null> {
  if (e.art === 'knopf') return null;
  const z = await anfrageZuordnen(alle, telefon, e.text);
  if (!z) return null;
  if (nurNeuerAls && (!z.anfrage || z.anfrage.erstellt_am <= nurNeuerAls)) return null;

  // Gibt es zu dieser Anfrage schon ein Gespräch (etwa der WhatsApp Lead mit der Nummer aus dem Formular)?
  if (z.anfrage) {
    const vorhanden = await eins<Gespraech>(
      'SELECT * FROM wa_gespraeche WHERE (id = ? OR anfrage_id = ? OR (referenz IS NOT NULL AND referenz = ?)) AND telefon != ? ORDER BY erstellt_am DESC LIMIT 1',
      z.anfrage.whatsapp_gespraech_id ?? '', z.anfrage.id, z.anfragenummer ?? angabenDerAnfrage(z.anfrage).anfragenummer ?? '', telefon,
    );
    if (vorhanden && vorhanden.status === 'abgemeldet') return null;
    if (vorhanden && Date.now() - Date.parse(vorhanden.erstellt_am) < DUBLETTE_TAGE * 86_400_000) {
      // Der Lead schreibt von einer anderen Nummer. Noch keine Antwort im alten Chat: das Gespräch zieht um.
      if (vorhanden.status === 'offen' && !vorhanden.letzte_eingang_am && !(await eins('SELECT id FROM wa_gespraeche WHERE telefon = ?', telefon))) {
        await setzen(vorhanden.id, { telefon, zuordnung: z.weg, start_gesendet_am: vorhanden.start_gesendet_am ?? jetztIso(), letzte_eingang_am: jetztIso() });
        const umgezogen = (await gespraech(vorhanden.id))!;
        await protokoll(umgezogen, 'ein', e.art, e.text, e.waId, null, 1);
        await anfrageUebernommen(umgezogen, z.anfrage, z.weg);
        await gelesenUndTippt(e.waId);
        await setzen(umgezogen.id, { schritt: 'problem' });
        await frageSenden({ ...umgezogen, schritt: 'problem' }, 'problem', TEXTE.selbstStart(umgezogen.vorname, firmaText(umgezogen)));
        return umgezogen.id;
      }
      await teamInformieren(vorhanden, `Der Lead schreibt jetzt auch von der Nummer +${telefon} (${z.weg === 'nummer' ? 'Nummer aus der Anfrage' : `Anfragenummer ${z.anfragenummer}`}). Der Bot antwortet dort nicht, bitte selbst übernehmen.`);
      return vorhanden.id;
    }
  }

  const a = z.anfrage;
  const angaben = a ? angabenDerAnfrage(a) : null;
  const name = a ? namenPruefen(a.name, 120) ?? a.name.slice(0, 120) : 'Unbekannt';
  const id = neueId();
  const jetztText = jetztIso();
  const abgemeldet = STOPP.test(e.text.trim());
  // Zwei schnelle Nachrichten dürfen kein zweites Gespräch anlegen: nur einfügen, wenn die Nummer frei ist
  const res = await ausfuehren(
    `INSERT INTO wa_gespraeche (id, telefon, name, vorname, firma, webseite, email, hat_website, quelle, hinweise, schritt, status,
       start_faellig_am, start_gesendet_am, letzte_eingang_am, referenz, anfrage_id, zuordnung, erstellt_am, aktualisiert_am)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'whatsapp selbst', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM wa_gespraeche WHERE telefon = ? AND erstellt_am > ?)`,
    id, telefon, name, a ? vorname(name) : '', a?.unternehmen ? namenPruefen(a.unternehmen, 160) : null,
    angaben?.website ?? null, a?.email ?? null, angaben ? (angaben.hatWebsite ? 1 : 0) : 1,
    a ? 'problem' : 'kennenlernen', abgemeldet ? 'abgemeldet' : 'offen',
    jetztText, jetztText, jetztText, z.anfragenummer ?? angaben?.anfragenummer ?? null, a?.id ?? null, z.weg, jetztText, jetztText,
    telefon, nurNeuerAls ?? '',
  );
  if (!res.meta?.changes) return null;
  const g = (await gespraech(id))!;
  await protokoll(g, 'ein', e.art, e.text, e.waId, null, 1);
  if (abgemeldet) {
    await schreiben(g, TEXTE.abgemeldet);
    return id;
  }
  await gelesenUndTippt(e.waId);
  if (a) {
    await anfrageUebernommen(g, a, z.weg);
    await frageSenden(g, 'problem', TEXTE.selbstStart(g.vorname, firmaText(g)));
  } else {
    await schreiben(g, TEXTE.kennenlernen);
  }
  return id;
}

/** Anfrage in Let's Meet und Close als "per WhatsApp übernommen" markieren, damit niemand mehr anruft. */
async function anfrageUebernommen(g: Gespraech, a: AnfrageTreffer, weg: string) {
  const am = jetztIso();
  await ausfuehren('UPDATE anfragen SET whatsapp_gespraech_id = ?, whatsapp_am = ? WHERE id = ?', g.id, am, a.id);
  await setzen(g.id, { anfrage_id: a.id });
  await crmMelden('anfrage.whatsapp_uebernommen', {
    anfrage_id: a.id,
    quelle: 'website-entwurf',
    name: a.name,
    email: a.email,
    telefon: a.telefon,
    whatsapp: `+${g.telefon}`,
    unternehmen: a.unternehmen,
    anfragenummer: g.referenz,
    zuordnung: weg === 'nummer' ? 'Absendernummer' : 'Anfragenummer',
    chat: `${basisUrl()}/app/whatsapp/${g.id}`,
    zeit: am,
  });
}

/** Nachricht vom Team aus der WhatsApp Business App: der Bot hält sich ab jetzt raus. */
export async function teamNachricht(telefon: string, waId: string, text: string) {
  const g = await eins<Gespraech>('SELECT * FROM wa_gespraeche WHERE telefon = ? ORDER BY erstellt_am DESC LIMIT 1', telefon);
  if (!g) return;
  const eigene = await eins<{ id: string }>('SELECT id FROM wa_nachrichten WHERE wa_message_id = ?', waId);
  if (eigene) return;
  await protokoll(g, 'team', 'text', text, waId);
  if (g.status !== 'abgemeldet') await setzen(g.id, { status: 'mensch' });
}

/**
 * Arbeitet alle offenen Nachrichten eines Gesprächs ab. Eine einfache Sperre verhindert, dass zwei
 * schnell hintereinander geschickte Nachrichten parallel laufen, die zweite wird danach mit erledigt.
 */
export async function abarbeiten(id: string, tiefe = 0) {
  const bis = new Date(Date.now() + 60_000).toISOString();
  const sperre = await ausfuehren(
    'UPDATE wa_gespraeche SET in_arbeit_bis = ? WHERE id = ? AND (in_arbeit_bis IS NULL OR in_arbeit_bis < ?)',
    bis, id, jetztIso(),
  );
  if (!sperre.meta?.changes) return;
  try {
    for (let runde = 0; runde < 3; runde++) {
      const offen = await alle<WaNachricht>("SELECT * FROM wa_nachrichten WHERE gespraech_id = ? AND richtung = 'ein' AND verarbeitet = 0 ORDER BY erstellt_am", id);
      if (!offen.length) break;
      await ausfuehren(`UPDATE wa_nachrichten SET verarbeitet = 1 WHERE id IN (${offen.map(() => '?').join(',')})`, ...offen.map((n) => n.id));
      const g = await gespraech(id);
      if (!g || !['offen', 'gebucht', 'anrufen'].includes(g.status)) break;
      const knopf = [...offen].reverse().find((n) => n.wert)?.wert ?? null;
      const text = offen.map((n) => n.text).join('\n');
      try {
        await schrittVerarbeiten(g, { text, knopf });
      } catch (fehler) {
        console.error('Schritt fehlgeschlagen', id, fehler);
        await setzen(id, { fehler: String((fehler as Error)?.message ?? fehler).slice(0, 500) });
      }
    }
  } finally {
    await setzen(id, { in_arbeit_bis: null });
  }
  const rest = await eins<{ n: number }>("SELECT COUNT(*) AS n FROM wa_nachrichten WHERE gespraech_id = ? AND richtung = 'ein' AND verarbeitet = 0", id);
  if (rest?.n && tiefe < 2) await abarbeiten(id, tiefe + 1);
}

/* ---------- Die Schritte ---------- */

const problemOptionen = (g: Gespraech) => (g.hat_website ? PROBLEM_WEBSITE : PROBLEM_OHNE);

function aufgabe(g: Gespraech, schritt: string) {
  const optionen = (o: Record<string, string>) => Object.entries(o).map(([id, t]) => `${id} (${t})`).join(', ');
  switch (schritt) {
    case 'kennenlernen':
      return `Frage: "${TEXTE.kennenlernen}" Der Lead hat selbst geschrieben und ist noch keiner Anfrage zugeordnet. wert = "Vorname Nachname | Firma" (Teile, die fehlen, leer lassen, nichts erfinden). Kurze Antwort ohne Frage, gern leer.`;
    case 'website_frage':
      return 'Frage: Habt ihr schon eine eigene Website? Knopffrage, Options IDs: ja, nein. Nennt der Lead eine Adresse, trage sie in "link" ein und wert ist ja.';
    case 'email':
      return 'Frage: An welche E-Mail-Adresse dürfen wir die Terminbestätigung schicken? wert = die genannte Adresse. Keine Frage in "antwort", gern leer.';
    case 'start':
    case 'problem':
      return `Frage: "${g.hat_website ? TEXTE.problemWebsite : TEXTE.problemOhne}" Knopffrage, Options IDs: ${optionen(problemOptionen(g))}. Beschreibt der Lead etwas anderes, ist wert "anderes:" gefolgt von der Kurzfassung.`;
    case 'problem_text':
      return `Frage: "${g.hat_website ? TEXTE.problemText : TEXTE.problemTextOhne}" Freitext. Spiegle kurz in "antwort", ohne Frage.`;
    case 'ziel':
      return `Frage: "${TEXTE.ziel}" Freitext. Spiegle das Ziel kurz in "antwort", ohne Frage.`;
    case 'zeitpunkt':
      return `Frage: "${TEXTE.zeitpunkt}" Knopffrage, Options IDs: ${optionen(ZEITPUNKT)}.`;
    case 'budget':
      return `Frage: Websites starten ab 5.000 €, wäre das ein passender Rahmen, wenn der Entwurf überzeugt? Setze budget_haltung: offen (ja oder eher ja), unsicher (kommt drauf an, zögert), nein (klar kein Budget). Bei offen keine Frage in "antwort".`;
    case 'einwand':
      return `Einwandbehandlung zum Budget. Bisherige Antwort: ${g.budget ?? ''}. Setze budget_haltung: offen (lässt sich auf das Gespräch ein), unsicher, nein (klar kein Budget oder kein Interesse). ${
        g.einwand_versuche >= 2
          ? 'Es gab schon zwei Anläufe: keine weitere Einwandbehandlung, "antwort" leer lassen.'
          : `Das ist Anlauf ${g.einwand_versuche + 1} von 2${
              g.einwand_versuche
                ? '. Nimm einen anderen Blickwinkel als beim ersten Mal und wiederhole weder Argumente noch Formulierungen aus deinen bisherigen Nachrichten im Verlauf (kam schon die Frage nach dem Wert eines neuen Kunden, dann jetzt zum Beispiel: Entwurf und Gespräch sind kostenlos und unverbindlich, die Entscheidung fällt erst danach)'
                : ''
            }. ${g.budget === 'Eher zu viel' ? 'Der Lead findet den Rahmen eher zu viel: gehe auf den Preis ein, ohne ihn kleinzureden. ' : ''}Ist die Haltung unsicher oder nein, behandle den Einwand in "antwort" nach dem Setting Skript und ende mit einer Bedingungsfrage, die man mit ja oder nein beantworten kann.`
      } Ist sie offen, schreibe eine kurze positive Überleitung ohne Frage.`;
    case 'termin':
      return `Terminwahl. Angeboten: ${slotsLesen(g).map((s, i) => `t_${i} (${slotLang(s, TZ)})`).join(', ')}, t_andere (andere Zeit). Wählt der Lead einen, ist wert die ID. Nennt er einen anderen Wunsch, ist wert "t_andere" und fülle wunsch_datum, wunsch_uhrzeit oder wunsch_tageszeit.`;
    case 'wunschzeit':
      return 'Der Lead nennt seinen Wunschtermin. Fülle wunsch_datum (YYYY-MM-DD, nächster passender Tag ab heute), wunsch_uhrzeit (HH:MM) und wunsch_tageszeit, soweit genannt. Keine Frage in "antwort", gern leer.';
    case 'entscheider':
      return `Frage: "${TEXTE.entscheider}" Knopffrage, Options IDs: ich (entscheidet allein), mehr (noch jemand dabei, dann wert "mehr:" und wer).`;
    case 'entscheider_text':
      return 'Der Lead nennt, wer noch mit entscheidet. wert = Name oder Rolle. Kurze Antwort ohne Frage.';
    case 'briefing':
      return `Frage: "${TEXTE.briefing}" Trage eine genannte Adresse in "link" ein. Kurze, freundliche Antwort ohne Frage.`;
    default:
      return `Der Termin ist gebucht${g.buchung_id ? '' : ' oder in Klärung'}. Beantworte Fragen kurz und freundlich, ohne neue Frage. Will der Lead verschieben oder absagen: termin_aendern.`;
  }
}

async function verstehen(g: Gespraech, schritt: string, text: string): Promise<KiErgebnis | null> {
  if (!kiAktiv()) return null;
  // Kostenbremse über alle Chats: ab dem Tageslimit läuft der Bot ohne Claude weiter (nur Knöpfe und feste Texte)
  const limit = Number(env.WHATSAPP_KI_TAGESLIMIT) || KI_TAGESLIMIT_STANDARD;
  const heute = await eins<{ n: number }>("SELECT COUNT(*) AS n FROM wa_nachrichten WHERE richtung = 'ein' AND art != 'knopf' AND erstellt_am >= ?", `${datumInZone(jetzt(), 'UTC')}T00:00:00`);
  if ((heute?.n ?? 0) > limit) {
    console.warn('Tageslimit für Claude erreicht');
    return null;
  }
  const verlauf = await alle<WaNachricht>('SELECT * FROM wa_nachrichten WHERE gespraech_id = ? ORDER BY erstellt_am DESC LIMIT 14', g.id);
  return kiVerstehen({
    aufgabe: aufgabe(g, schritt),
    lead: {
      vorname: g.vorname,
      firma: g.firma,
      webseite: g.webseite || (g.hat_website ? null : 'noch keine'),
      problem: g.problem,
      ziel: g.ziel,
      zeitpunkt: g.zeitpunkt,
      budget: g.budget,
    },
    verlauf: bisherigerVerlauf(verlauf.reverse()),
    eingang: saeubern(text, MAX_EINGANG),
    heute: new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(jetzt()) + ` (${datumInZone(jetzt(), TZ)})`,
  }).then(async (ki) => {
    // Verworfene Antworten sieht das Team im Backoffice unter "Fehler"
    if (ki?.verworfen) await setzen(g.id, { fehler: `Antwort von Claude verworfen (${ki.verworfen}), fester Text gesendet` });
    return ki;
  });
}

/** Verlauf ohne die gerade eingegangenen Nachrichten am Ende, die kommen als "eingang" mit. */
function bisherigerVerlauf(nachrichten: WaNachricht[]) {
  const liste = [...nachrichten];
  while (liste.length && liste[liste.length - 1].richtung === 'ein') liste.pop();
  return liste.map((n) => ({ von: n.richtung === 'ein' ? ('lead' as const) : ('wir' as const), text: n.text }));
}

/** Die letzten Nachrichten des Bots in diesem Chat, damit sich die Einwandbehandlung nicht wiederholt. */
async function letzteAusgaenge(id: string) {
  const liste = await alle<{ text: string | null }>("SELECT text FROM wa_nachrichten WHERE gespraech_id = ? AND richtung = 'aus' ORDER BY erstellt_am DESC LIMIT 8", id);
  return liste.map((n) => n.text ?? '');
}

const vor = (text: string | undefined | null) => (text?.trim() ? `${text.trim()}\n\n` : '');

/**
 * Name und Firma ohne Claude: "Ich bin Lisa Becker von Becker Bau", "Lisa Becker, Becker Bau GmbH"
 * oder zwei Zeilen. Begrüßungen und Floskeln fallen weg.
 */
export function nameUndFirma(text: string): [string, string] {
  const t = text
    .replace(/^\s*(hallo|hi|hey|moin|servus|guten (tag|morgen|abend))[\s,!.]*/i, '')
    .replace(/\b(ich bin|ich hei(ß|ss)e|mein name ist|hier ist|hier schreibt|das ist)\s+/gi, '')
    .replace(/\b(die firma|unsere firma|firma|unternehmen)( (hei(ß|ss)t|ist))?:?\s*/gi, '')
    .trim();
  const teile = t.split(/\s*(?:\n|,|;|\s+-\s+|\s+von der\s+|\s+von\s+|\s+vom\s+|\s+bei der\s+|\s+bei\s+|\s+für\s+|\s+fuer\s+)\s*/i).filter(Boolean);
  const sauber = (x = '') => x.replace(/[.!?]+$/, '').trim();
  return [sauber(teile[0]), sauber(teile.slice(1).join(' '))];
}

/** Schickt die Frage eines Schritts (mit Knöpfen), optional mit Text davor. */
async function frageSenden(g: Gespraech, schritt: string, davor = '') {
  switch (schritt) {
    case 'kennenlernen':
      return schreiben(g, vor(davor) + TEXTE.kennenlernenNochmal);
    case 'website_frage':
      return schreiben(g, vor(davor) + TEXTE.websiteFrage(g.vorname), [
        { id: 'w_ja', titel: 'Ja, haben wir' },
        { id: 'w_nein', titel: 'Noch keine' },
      ]);
    case 'email':
      return schreiben(g, vor(davor) + TEXTE.email);
    case 'start':
    case 'problem':
      return schreiben(
        g,
        vor(davor) + (g.hat_website ? TEXTE.problemWebsite : TEXTE.problemOhne),
        Object.entries(problemOptionen(g)).map(([id, titel]) => ({ id: `p_${id}`, titel })),
      );
    case 'problem_text':
      return schreiben(g, vor(davor) + (g.hat_website ? TEXTE.problemText : TEXTE.problemTextOhne));
    case 'ziel':
      return schreiben(g, vor(davor) + TEXTE.ziel);
    case 'zeitpunkt':
      return schreiben(g, vor(davor) + TEXTE.zeitpunkt, Object.entries(ZEITPUNKT).map(([id, titel]) => ({ id: `z_${id}`, titel })));
    case 'budget':
      return schreiben(g, vor(davor) + TEXTE.budget, [
        { id: 'b_ja', titel: 'Ja, das passt' },
        { id: 'b_kommtdrauf', titel: 'Kommt drauf an' },
        { id: 'b_zuviel', titel: 'Eher zu viel' },
      ]);
    case 'einwand':
      return schreiben(g, davor.trim() || TEXTE.einwandErsatz, [
        { id: 'e_ja', titel: 'Ja, dann schon' },
        { id: 'e_nein', titel: 'Eher nicht' },
      ]);
    case 'termin':
      return terminAnbieten(g, davor);
    case 'wunschzeit':
      return schreiben(g, vor(davor) + TEXTE.wunschzeit);
    case 'entscheider':
      return schreiben(g, vor(davor) + TEXTE.entscheider, [
        { id: 'd_ich', titel: 'Nur ich' },
        { id: 'd_mehr', titel: 'Noch jemand' },
      ]);
    case 'entscheider_text':
      return schreiben(g, vor(davor) + TEXTE.entscheiderText);
    case 'briefing':
      return schreiben(g, vor(davor) + TEXTE.briefing, [{ id: 'f_keine', titel: 'Keine im Kopf' }]);
    default:
      if (davor.trim()) return schreiben(g, davor.trim());
  }
}

async function weiter(g: Gespraech, schritt: string, felder: Partial<Record<keyof Gespraech, string | number | null>>, davor = '') {
  await setzen(g.id, { ...felder, schritt });
  const neu = (await gespraech(g.id))!;
  await frageSenden(neu, schritt, davor);
}

async function verabschieden(g: Gespraech) {
  await setzen(g.id, { status: 'verabschiedet', schritt: 'fertig' });
  await schreiben(g, TEXTE.verabschiedung(g.vorname, firmaText(g)));
  await teamInformieren(g, 'Der Lead wurde verabschiedet (kein Budget oder kein Interesse). Zur Info, keine Aktion nötig.');
}

async function anMenschen(g: Gespraech, davor = '') {
  await setzen(g.id, { status: 'mensch' });
  await schreiben(g, vor(davor) + TEXTE.mensch);
  await teamInformieren(g, 'Der Lead möchte mit einem Menschen sprechen. Bitte selbst übernehmen, der Bot pausiert in diesem Chat.');
}

/** Reaktionen, die in jedem Schritt gleich sind. true = erledigt. */
async function allgemein(g: Gespraech, ki: KiErgebnis | null, schritt: string) {
  if (!ki) return false;
  if (ki.einordnung === 'kein_interesse') {
    await verabschieden(g);
    return true;
  }
  if (ki.einordnung === 'will_mensch') {
    await anMenschen(g, ki.antwort);
    return true;
  }
  if (ki.einordnung === 'termin_aendern' && g.buchung_id) {
    await schreiben(g, TEXTE.umbuchen(`${basisUrl()}/termin/${g.buchung_id}`));
    return true;
  }
  if (ki.einordnung === 'frage' || ki.einordnung === 'einwand' || ki.einordnung === 'unklar') {
    await frageSenden(g, schritt, ki.antwort || (ki.einordnung === 'unklar' ? TEXTE.unverstanden : ''));
    return true;
  }
  return false;
}

async function schrittVerarbeiten(g: Gespraech, e: { text: string; knopf: string | null }) {
  const text = e.text.trim();
  if (STOPP.test(text)) {
    await setzen(g.id, { status: 'abgemeldet' });
    await schreiben(g, TEXTE.abgemeldet);
    return;
  }
  const knopf = e.knopf;
  // Den vorausgefüllten Text der Landingpage noch einmal geschickt: keine Antwort, die offene Frage wiederholen
  if (!knopf && anfragenummerAusText(text) && g.schritt !== 'kennenlernen') return frageSenden(g, g.schritt, 'Deine Anfrage habe ich schon 🙂');

  switch (g.schritt) {
    case 'kennenlernen': {
      // Selbst geschrieben, keine Anfrage gefunden: Name und Firma erfragen, E-Mail gleich mitnehmen
      const email = text.match(/[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() ?? null;
      const rest = email ? text.replace(email, ' ') : text;
      const ki = await verstehen(g, 'kennenlernen', rest);
      if (ki && ki.einordnung !== 'beantwortet' && ki.einordnung !== 'unklar' && (await allgemein(g, ki, 'kennenlernen'))) return;
      const [nameRoh, firmaRoh] = ki?.wert ? ki.wert.split('|').map((t) => t.trim()) : nameUndFirma(rest);
      const name = namenPruefen(nameRoh, 120);
      const firma = namenPruefen(firmaRoh, 160);
      const felder = { ...(email && emailGueltig(email) ? { email } : {}), ...(firma ? { firma } : {}) };
      if (!name || name.length < 2) {
        // Ein zweites Mal nachfragen (Zähler einwand_versuche ist in diesem Schritt noch frei), dann übernimmt das Team
        if (g.einwand_versuche >= 1) return anMenschen(g);
        await setzen(g.id, { ...felder, einwand_versuche: 1 });
        return frageSenden(g, 'kennenlernen', ki?.antwort ?? '');
      }
      return weiter(g, 'website_frage', { ...felder, name, vorname: vorname(name), einwand_versuche: 0 });
    }
    case 'website_frage': {
      let ja: boolean | null = knopf === 'w_ja' ? true : knopf === 'w_nein' ? false : null;
      let webseite: string | null = text.match(/(https?:\/\/\S+|(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/\S*)?)/i)?.[0] ?? null;
      if (ja === null && webseite) ja = true;
      if (ja === null && /\b(nein|nö|noch nicht|keine|nicht)\b/i.test(text)) ja = false;
      if (ja === null && /\b(ja|jo|jap|klar|haben wir|gibt es)\b/i.test(text)) ja = true;
      if (ja === null) {
        const ki = await verstehen(g, 'website_frage', text);
        if (await allgemein(g, ki, 'website_frage')) return;
        webseite = ki?.link || null;
        ja = ki?.wert === 'ja' ? true : ki?.wert === 'nein' ? false : null;
        if (ja === null) return frageSenden(g, 'website_frage', TEXTE.unverstanden);
      }
      return weiter(g, 'problem', { hat_website: ja ? 1 : 0, webseite: ja ? webseite : null });
    }
    case 'email': {
      const email = text.match(/[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() ?? '';
      if (!emailGueltig(email)) {
        const ki = await verstehen(g, 'email', text);
        if (ki && ki.einordnung !== 'beantwortet' && ki.einordnung !== 'unklar' && (await allgemein(g, ki, 'email'))) return;
        return schreiben(g, TEXTE.emailUngueltig);
      }
      await setzen(g.id, { email });
      // Der gewählte Termin wartet in angebotene_slots
      return buchen((await gespraech(g.id))!, slotsLesen(g)[0]);
    }
    case 'start':
    case 'problem': {
      if (knopf === 'n_los') return frageSenden(g, 'problem', 'Super, danke dir!');
      if (knopf === 'n_spaeter') return schreiben(g, TEXTE.spaeter);
      let id = knopf?.startsWith('p_') ? knopf.slice(2) : null;
      let beschreibung: string | null = null;
      let ki: KiErgebnis | null = null;
      if (!id) {
        ki = await verstehen(g, 'problem', text);
        if (await allgemein(g, ki, 'problem')) return;
        const wert = ki?.wert ?? '';
        if (wert in problemOptionen(g) && wert !== 'anderes') id = wert;
        else {
          id = 'anderes';
          beschreibung = wert.replace(/^anderes:?\s*/i, '') || text;
        }
      }
      if (id === 'anderes' && !beschreibung) return weiter(g, 'problem_text', {});
      const problem = beschreibung ?? problemOptionen(g)[id!] ?? text;
      const quittung = ki?.antwort || TEXTE.problemQuittung[id!] || '';
      return weiter(g, 'ziel', { problem }, quittung);
    }
    case 'problem_text': {
      const ki = await verstehen(g, 'problem_text', text);
      if (ki && ki.einordnung !== 'beantwortet' && (await allgemein(g, ki, 'problem_text'))) return;
      return weiter(g, 'ziel', { problem: ki?.wert || text.slice(0, 300) }, ki?.antwort || 'Danke dir, das hilft uns schon sehr.');
    }
    case 'ziel': {
      const ki = await verstehen(g, 'ziel', text);
      if (ki && ki.einordnung !== 'beantwortet' && (await allgemein(g, ki, 'ziel'))) return;
      return weiter(g, 'zeitpunkt', { ziel: ki?.wert || text.slice(0, 300) }, ki?.antwort || 'Verstanden, das nehmen wir mit in den Entwurf.');
    }
    case 'zeitpunkt': {
      let id = knopf?.startsWith('z_') ? knopf.slice(2) : null;
      if (!id) {
        const ki = await verstehen(g, 'zeitpunkt', text);
        if (await allgemein(g, ki, 'zeitpunkt')) return;
        id = ki?.wert && ki.wert in ZEITPUNKT ? ki.wert : 'offen';
      }
      return weiter(g, 'budget', { zeitpunkt: ZEITPUNKT[id] ?? id, heiss: id === 'sofort' ? 1 : 0 });
    }
    case 'budget': {
      let haltung: 'offen' | 'unsicher' | 'nein' | null = knopf === 'b_ja' ? 'offen' : knopf === 'b_kommtdrauf' ? 'unsicher' : knopf === 'b_zuviel' ? 'nein' : null;
      let ki: KiErgebnis | null = null;
      if (!haltung) {
        ki = await verstehen(g, 'budget', text);
        if (ki?.einordnung === 'kein_interesse' || ki?.einordnung === 'will_mensch') return allgemein(g, ki, 'budget');
        if (ki?.einordnung === 'frage') return frageSenden(g, 'budget', ki.antwort);
        haltung = ki?.budget_haltung || null;
        if (!haltung) return frageSenden(g, 'budget', ki?.antwort || TEXTE.unverstanden);
      }
      if (haltung === 'offen') return weiter(g, 'termin', { budget: 'Passt', heiss: g.zeitpunkt === ZEITPUNKT.sofort ? 1 : 0 }, ki?.antwort || 'Super, freut mich!');
      // Kommt drauf an oder eher zu viel: Einwandbehandlung, das Gespräch endet hier nicht
      const budget = haltung === 'nein' ? 'Eher zu viel' : 'Kommt drauf an';
      await setzen(g.id, { budget, heiss: 0, schritt: 'einwand' });
      const neu = (await gespraech(g.id))!;
      const einwand = await verstehen(neu, 'einwand', knopf ? (haltung === 'nein' ? 'Eher zu viel' : 'Kommt drauf an') : text);
      await setzen(g.id, { einwand_versuche: 1 });
      return frageSenden(neu, 'einwand', einwandAntwort(einwand?.antwort, await letzteAusgaenge(g.id), 1));
    }
    case 'einwand': {
      let haltung: 'offen' | 'unsicher' | 'nein' | null = knopf === 'e_ja' ? 'offen' : knopf === 'e_nein' ? 'nein' : null;
      let ki: KiErgebnis | null = null;
      if (!haltung || haltung === 'nein') {
        ki = await verstehen(g, 'einwand', text || 'Eher nicht');
        if (ki?.einordnung === 'will_mensch') return allgemein(g, ki, 'einwand');
        if (ki?.einordnung === 'frage' && ki.antwort) return frageSenden(g, 'einwand', ki.antwort);
        haltung = haltung ?? (ki?.budget_haltung || 'unsicher');
        if (ki?.einordnung === 'kein_interesse') haltung = 'nein';
      }
      if (haltung === 'offen') return weiter(g, 'termin', { budget: `${g.budget}, nach Rückfrage offen` }, ki?.antwort || 'Sehr gut, dann schauen wir uns das gemeinsam an.');
      if (g.einwand_versuche >= 2) {
        // Nach zwei Anläufen: bei klarem Nein höflich verabschieden, bei Unsicherheit trotzdem den Termin anbieten
        if (haltung === 'nein') return verabschieden(g);
        return weiter(g, 'termin', { budget: `${g.budget}, weiter unsicher` }, 'Lass es uns einfach anschauen, der Entwurf ist ja kostenlos und unverbindlich.');
      }
      await setzen(g.id, { einwand_versuche: g.einwand_versuche + 1 });
      // Zweiter Anlauf nie mit demselben Text wie der erste (fester Ersatztext oder Claude wiederholt sich)
      return frageSenden(g, 'einwand', einwandAntwort(ki?.antwort, await letzteAusgaenge(g.id), g.einwand_versuche + 1));
    }
    case 'termin': {
      const slots = slotsLesen(g);
      if (knopf === 't_andere') return weiter(g, 'wunschzeit', {});
      if (knopf?.startsWith('t_')) return buchen(g, slots[Number(knopf.slice(2))]);
      const ki = await verstehen(g, 'termin', text);
      if (ki?.wert?.startsWith('t_') && ki.wert !== 't_andere') return buchen(g, slots[Number(ki.wert.slice(2))]);
      if (ki?.wunsch_datum || ki?.wunsch_tageszeit || ki?.wunsch_uhrzeit) return wunschAnbieten(g, ki);
      if (await allgemein(g, ki, 'termin')) return;
      return weiter(g, 'wunschzeit', {});
    }
    case 'wunschzeit': {
      if (knopf?.startsWith('t_') && knopf !== 't_andere') return buchen(g, slotsLesen(g)[Number(knopf.slice(2))]);
      const ki = await verstehen(g, 'wunschzeit', text);
      if (ki?.wunsch_datum || ki?.wunsch_tageszeit || ki?.wunsch_uhrzeit) return wunschAnbieten(g, ki);
      if (await allgemein(g, ki, 'wunschzeit')) return;
      return frageSenden(g, 'wunschzeit', TEXTE.unverstanden);
    }
    case 'entscheider': {
      let id = knopf === 'd_ich' ? 'ich' : knopf === 'd_mehr' ? 'mehr' : null;
      let wer: string | null = null;
      if (!id) {
        const ki = await verstehen(g, 'entscheider', text);
        if (ki?.einordnung !== 'beantwortet' && (await allgemein(g, ki, 'entscheider'))) return;
        id = ki?.wert?.startsWith('mehr') ? 'mehr' : 'ich';
        wer = ki?.wert?.replace(/^mehr:?\s*/i, '') || null;
      }
      if (id === 'mehr' && !wer) return weiter(g, 'entscheider_text', {});
      await notizAnBuchung(g, `Entscheider: ${id === 'ich' ? 'entscheidet allein' : `noch dabei: ${wer}`}`);
      return weiter(g, 'briefing', { entscheider: id === 'ich' ? 'allein' : `mit ${wer}` });
    }
    case 'entscheider_text': {
      const ki = await verstehen(g, 'entscheider_text', text);
      const wer = ki?.wert || text.slice(0, 200);
      await notizAnBuchung(g, `Entscheider: noch dabei: ${wer}`);
      return weiter(g, 'briefing', { entscheider: `mit ${wer}` }, ki?.antwort || 'Top, danke dir!');
    }
    case 'briefing': {
      let briefing = knopf === 'f_keine' ? 'keine genannt' : null;
      let antwort = '';
      if (!briefing) {
        const link = text.match(/(https?:\/\/\S+|(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/\S*)?)/i)?.[0] ?? null;
        const ki = link ? null : await verstehen(g, 'briefing', text);
        if (ki && ki.einordnung !== 'beantwortet' && !ki.link && (await allgemein(g, ki, 'briefing'))) return;
        briefing = link || ki?.link || ki?.wert || text.slice(0, 300);
        antwort = ki?.antwort ?? '';
      }
      await notizAnBuchung(g, `Website, die gefällt: ${briefing}`);
      const b = g.buchung_id ? await buchungNachId(g.buchung_id) : null;
      await setzen(g.id, { briefing, schritt: 'fertig' });
      return schreiben(g, vor(antwort) + TEXTE.fertig(g.vorname, b ? slotLang(b.start_utc, TZ) : 'bald'));
    }
    default: {
      const ki = await verstehen(g, 'fertig', text);
      if (!ki) return; // ohne Claude keine freie Antwort, das Team sieht die Nachricht im Backoffice
      if (await allgemein(g, ki, 'fertig')) return;
      if (ki.antwort) await schreiben(g, ki.antwort);
    }
  }
}

/* ---------- Termine ---------- */

async function terminAnbieten(g: Gespraech, davor = '') {
  const bt = await botTerminart();
  const slots = bt ? await zweiVorschlaege(bt.terminart, bt.nutzer, Boolean(g.heiss)) : [];
  if (!slots.length) return keinTermin(g, davor);
  await setzen(g.id, { angebotene_slots: JSON.stringify(slots), schritt: 'termin' });
  return schreiben(g, TEXTE.termin(vor(davor)), [
    ...slots.map((s, i) => ({ id: `t_${i}`, titel: slotKurz(s, TZ) })),
    { id: 't_andere', titel: 'Andere Zeit' },
  ]);
}

async function wunschAnbieten(g: Gespraech, ki: KiErgebnis) {
  const bt = await botTerminart();
  if (!bt) return keinTermin(g);
  const r = await vorschlaegeZumWunsch(bt.terminart, bt.nutzer, Boolean(g.heiss), {
    datum: /^\d{4}-\d{2}-\d{2}$/.test(ki.wunsch_datum) ? ki.wunsch_datum : null,
    uhrzeit: /^\d{2}:\d{2}$/.test(ki.wunsch_uhrzeit) ? ki.wunsch_uhrzeit : null,
    tageszeit: ki.wunsch_tageszeit || null,
  });
  if (!r.slots.length) return keinTermin(g);
  const slots = r.slots.slice(0, 2);
  const hinweis = r.zuFrueh ? `Der Entwurf braucht ein paar Tage, deshalb geht es frühestens ab ${tagLang(r.frueh, TZ)}. ` : '';
  await setzen(g.id, { angebotene_slots: JSON.stringify(slots), schritt: 'termin' });
  return schreiben(g, `${hinweis}Wie wäre es mit einem dieser Termine?`, [
    ...slots.map((s, i) => ({ id: `t_${i}`, titel: slotKurz(s, TZ) })),
    { id: 't_andere', titel: 'Andere Zeit' },
  ]);
}

async function keinTermin(g: Gespraech, davor = '') {
  await setzen(g.id, { status: 'anrufen' });
  await schreiben(g, vor(davor) + TEXTE.keinTermin);
  await teamInformieren(g, 'Der Bot hat keinen freien Termin gefunden. Bitte einen Termin anbieten.');
}

async function buchen(g: Gespraech, slot: string | undefined) {
  const bt = await botTerminart();
  if (!bt || !slot) return terminAnbieten(g, TEXTE.unverstanden);
  if (!g.email) {
    // Selbst geschrieben ohne Anfrage: erst die E-Mail für die Bestätigung, der Termin wartet so lange
    await setzen(g.id, { angebotene_slots: JSON.stringify([slot]), schritt: 'email' });
    return schreiben(g, TEXTE.email);
  }
  if (!(await slotFrei({ terminart: bt.terminart, nutzer: bt.nutzer, startUtc: slot }))) return terminAnbieten(g, TEXTE.slotWeg);
  // Der Bot läuft schon im Hintergrund (waitUntil des Webhooks), Mails und CRM werden hier abgewartet
  const nebenher: Promise<unknown>[] = [];
  try {
    const buchung = await buchungAnlegen({
      terminart: bt.terminart,
      nutzer: bt.nutzer,
      startUtc: slot,
      gastName: g.name,
      gastEmail: g.email,
      gastTelefon: `+${g.telefon}`,
      gastZeitzone: TZ,
      antworten: [
        { label: 'Firma', wert: g.firma ?? '' },
        { label: 'Webseite', wert: g.webseite || 'keine' },
        { label: 'Was stört an der Website', wert: g.problem ?? '' },
        { label: 'Ziel der neuen Website', wert: g.ziel ?? '' },
        { label: 'Zeitpunkt', wert: g.zeitpunkt ?? '' },
        { label: 'Budget ab 5.000 €', wert: g.budget ?? '' },
      ].filter((a) => a.wert),
      nachricht: ['Gebucht über den WhatsApp Bot (Kostenloser Website-Entwurf).', g.hinweise].filter(Boolean).join('\n'),
      quelle: 'whatsapp entwurf',
      umbuchenVon: null,
      basis: basisUrl(),
      imHintergrund: (p) => nebenher.push(p),
    });
    await setzen(g.id, { buchung_id: buchung.id, status: 'gebucht', schritt: 'entscheider', angebotene_slots: null });
    const neu = (await gespraech(g.id))!;
    await frageSenden(neu, 'entscheider', TEXTE.gebucht(slotLang(slot, TZ), g.email));
  } catch (fehler) {
    if (fehler instanceof SlotVergeben) return terminAnbieten(g, TEXTE.slotWeg);
    throw fehler;
  } finally {
    await Promise.allSettled(nebenher);
  }
}

async function notizAnBuchung(g: Gespraech, zeile: string) {
  if (!g.buchung_id) return;
  await ausfuehren("UPDATE buchungen SET nachricht = COALESCE(nachricht || char(10), '') || ?, aktualisiert_am = ? WHERE id = ?", zeile, jetztIso(), g.buchung_id);
}

/* ---------- Cron: geplante Starts, Nachfassen, Erinnerung ---------- */

const vorStunden = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

export async function whatsappImCron() {
  const ergebnis = { gestartet: 0, nachgefasst: 0, team: 0, erinnert: 0, nachgeholt: 0 };
  const jetztText = jetztIso();

  // Liegen gebliebene Nachrichten (etwa wenn eine Antwort abgebrochen ist)
  const haengend = await alle<{ gespraech_id: string }>(
    "SELECT DISTINCT gespraech_id FROM wa_nachrichten WHERE richtung = 'ein' AND verarbeitet = 0 AND erstellt_am < ?",
    new Date(Date.now() - 60_000).toISOString(),
  );
  for (const h of haengend) {
    await abarbeiten(h.gespraech_id);
    ergebnis.nachgeholt++;
  }

  if (!darfSchreiben()) return ergebnis;

  // Leads aus der Nacht: erste Nachricht ab morgens
  const faellig = await alle<Gespraech>(
    "SELECT * FROM wa_gespraeche WHERE status = 'offen' AND start_gesendet_am IS NULL AND start_faellig_am <= ? LIMIT 20",
    jetztText,
  );
  for (const g of faellig) {
    await startSenden(g.id);
    ergebnis.gestartet++;
  }

  // Keine Antwort auf die erste Nachricht: nach 3 Stunden eine zweite Vorlage, nach 24 Stunden ruft das Team an
  const still = await alle<Gespraech>(
    "SELECT * FROM wa_gespraeche WHERE status = 'offen' AND schritt = 'problem' AND letzte_eingang_am IS NULL AND start_gesendet_am IS NOT NULL LIMIT 50",
  );
  for (const g of still) {
    if (g.nachfass_stufe === 0 && g.start_gesendet_am! <= vorStunden(3)) {
      await vorlage(g, VORLAGEN.nachfass.name, [g.vorname], VORLAGEN.nachfass.knoepfe, `${TEXTE.nachfass(g.vorname)}\n[Ja, los geht's | Später]`);
      await setzen(g.id, { nachfass_stufe: 1 });
      ergebnis.nachgefasst++;
    } else if (g.nachfass_stufe === 1 && g.start_gesendet_am! <= vorStunden(24)) {
      await setzen(g.id, { nachfass_stufe: 2, status: 'anrufen' });
      await teamInformieren(g, 'Keine Antwort auf WhatsApp seit 24 Stunden. Bitte anrufen.');
      ergebnis.team++;
    }
  }

  // Mitten im Gespräch hängen geblieben: nach 2 und 20 Stunden nachhaken, danach ruft das Team an
  const haengtFest = await alle<Gespraech>(
    `SELECT * FROM wa_gespraeche WHERE status = 'offen' AND letzte_eingang_am IS NOT NULL AND letzte_ausgang_am > letzte_eingang_am
       AND schritt NOT IN ('fertig') LIMIT 50`,
  );
  for (const g of haengtFest) {
    const fensterOffen = g.letzte_eingang_am! > vorStunden(23);
    if (g.nachfass_stufe === 0 && g.letzte_ausgang_am! <= vorStunden(2) && fensterOffen) {
      await setzen(g.id, { nachfass_stufe: 1 });
      await frageSenden(g, g.schritt, TEXTE.nachhaken(g.vorname)).catch(() => {});
      ergebnis.nachgefasst++;
    } else if (g.nachfass_stufe === 1 && g.letzte_ausgang_am! <= vorStunden(18) && fensterOffen) {
      await setzen(g.id, { nachfass_stufe: 2 });
      await frageSenden(g, g.schritt, TEXTE.nachhaken(g.vorname)).catch(() => {});
      ergebnis.nachgefasst++;
    } else if (g.nachfass_stufe >= 1 && !fensterOffen && !g.team_informiert_am) {
      await setzen(g.id, { nachfass_stufe: 3, status: 'anrufen' });
      await teamInformieren(g, 'Der Lead antwortet seit fast 24 Stunden nicht mehr. Bitte anrufen.');
      ergebnis.team++;
    }
  }

  // Erinnerung am Vortag
  const gebucht = await alle<Gespraech>("SELECT * FROM wa_gespraeche WHERE status = 'gebucht' AND erinnerung_gesendet = 0 AND buchung_id IS NOT NULL LIMIT 50");
  for (const g of gebucht) {
    let b = await buchungNachId(g.buchung_id!);
    for (let i = 0; b?.umgebucht_zu && i < 5; i++) b = await buchungNachId(b.umgebucht_zu);
    if (!b || b.status !== 'bestaetigt') {
      await setzen(g.id, { erinnerung_gesendet: 1 });
      continue;
    }
    if (b.id !== g.buchung_id) await setzen(g.id, { buchung_id: b.id });
    const bis = Date.parse(b.start_utc) - Date.now();
    if (bis > 26 * 3_600_000 || bis < 3 * 3_600_000) continue;
    const wann = slotLang(b.start_utc, TZ).replace(/^\w+, /, '');
    await setzen(g.id, { erinnerung_gesendet: 1 });
    if (g.letzte_eingang_am && g.letzte_eingang_am > vorStunden(23)) await schreiben(g, TEXTE.erinnerung(g.vorname, wann)).catch(() => {});
    else await vorlage(g, VORLAGEN.erinnerung.name, [g.vorname, wann], [], TEXTE.erinnerung(g.vorname, wann));
    ergebnis.erinnert++;
  }

  return ergebnis;
}

/* ---------- Backoffice ---------- */

export async function botPausieren(id: string, pausieren: boolean) {
  const g = await gespraech(id);
  if (!g || g.status === 'abgemeldet') return;
  if (pausieren) await setzen(id, { status: 'mensch' });
  else await setzen(id, { status: g.buchung_id ? 'gebucht' : 'offen', nachfass_stufe: 0, team_informiert_am: null });
}

/**
 * Nach "Stopp" wieder freischalten, etwa wenn der Kunde ausdrücklich doch wieder Nachrichten möchte.
 * Der Bot schreibt nicht von sich aus: erst wenn der Kunde schreibt, macht er beim alten Schritt weiter.
 * Nachhaken und "bitte anrufen" bleiben aus, bis er sich meldet (eingangVerarbeiten setzt nachfass_stufe zurück).
 * Ist nur noch die Sperre übrig (Gespräch gelöscht), fällt sie weg und die Nummer startet wie neu.
 */
export async function botFreischalten(id: string) {
  const g = await gespraech(id);
  if (!g || g.status !== 'abgemeldet') return null;
  if (g.name === 'Abgemeldet' && !g.vorname) {
    await ausfuehren('DELETE FROM wa_nachrichten WHERE gespraech_id = ?', id);
    await ausfuehren('DELETE FROM wa_gespraeche WHERE id = ?', id);
    return 'entfernt' as const;
  }
  await setzen(id, {
    status: g.buchung_id ? 'gebucht' : 'offen',
    nachfass_stufe: 3,
    team_informiert_am: jetztIso(),
    fehler: null,
  });
  return 'freigeschaltet' as const;
}

/** Aufbewahrung der Gespräche: 12 Monate nach dem letzten Kontakt (so steht es in der Datenschutzerklärung). */
export const WA_AUFBEWAHRUNG_TAGE = 365;

/**
 * Ein Gespräch löschen. Nach "Stopp" bleibt nur die Telefonnummer mit Status abgemeldet stehen,
 * alles andere wird geleert, damit diese Nummer nie wieder angeschrieben wird. Sonst geht alles.
 */
export async function gespraechLoeschen(id: string) {
  const g = await gespraech(id);
  if (!g) return null;
  await ausfuehren('DELETE FROM wa_nachrichten WHERE gespraech_id = ?', id);
  if (g.status === 'abgemeldet') {
    await sperreBehalten(id);
    return 'gesperrt' as const;
  }
  await ausfuehren('DELETE FROM wa_gespraeche WHERE id = ?', id);
  return 'geloescht' as const;
}

/** Abgemeldetes Gespräch auf die Sperre reduzieren: nur Telefonnummer, Status und Zeitstempel bleiben. */
async function sperreBehalten(id: string) {
  await ausfuehren(
    `UPDATE wa_gespraeche SET name = 'Abgemeldet', vorname = '', firma = NULL, webseite = NULL, email = NULL, quelle = NULL,
       hinweise = NULL, problem = NULL, ziel = NULL, zeitpunkt = NULL, budget = NULL, entscheider = NULL, briefing = NULL,
       angebotene_slots = NULL, buchung_id = NULL, fehler = NULL WHERE id = ?`,
    id,
  );
}

/** Cron: Gespräche 12 Monate nach dem letzten Kontakt löschen, abgemeldete Nummern bleiben als Sperre. */
export async function whatsappAufraeumen() {
  const grenze = new Date(Date.now() - WA_AUFBEWAHRUNG_TAGE * 86_400_000).toISOString();
  const alt = await alle<{ id: string }>(
    `SELECT id FROM wa_gespraeche
     WHERE MAX(aktualisiert_am, COALESCE(letzte_eingang_am, ''), COALESCE(letzte_ausgang_am, '')) < ?
       AND NOT (status = 'abgemeldet' AND name = 'Abgemeldet' AND vorname = '')
     LIMIT 200`,
    grenze,
  );
  for (const g of alt) await gespraechLoeschen(g.id);
  return alt.length;
}

export const ZUORDNUNG_TEXT: Record<Gespraech['zuordnung'], string> = {
  formular: 'Formular mit WhatsApp Einwilligung',
  nummer: 'Selbst geschrieben, über die Absendernummer zugeordnet',
  anfragenummer: 'Selbst geschrieben, über die Anfragenummer zugeordnet',
  keine: 'Selbst geschrieben, nicht zugeordnet',
};

export const STATUS_TEXT: Record<Gespraech['status'], string> = {
  offen: 'Bot im Gespräch',
  gebucht: 'Termin gebucht',
  verabschiedet: 'Verabschiedet',
  anrufen: 'Bitte anrufen',
  mensch: 'Team übernimmt',
  abgemeldet: 'Abgemeldet',
};

export const SCHRITT_TEXT: Record<string, string> = {
  kennenlernen: 'Name und Firma (nicht zugeordnet)',
  website_frage: 'Website vorhanden?',
  email: 'E-Mail für die Bestätigung',
  start: 'Erste Nachricht geplant',
  problem: 'Was stört',
  problem_text: 'Was stört (Freitext)',
  ziel: 'Ziel',
  zeitpunkt: 'Zeitpunkt',
  budget: 'Budget',
  einwand: 'Einwandbehandlung',
  termin: 'Terminwahl',
  wunschzeit: 'Wunschzeit',
  entscheider: 'Entscheider',
  entscheider_text: 'Entscheider',
  briefing: 'Website, die gefällt',
  fertig: 'Fertig',
};
