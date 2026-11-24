/**
 * Mailversand über Resend und Vorlagen im Branding von That's it. Marketing.
 * Tabellenlayout und Inlinestile sind Absicht, Mailprogramme können kein modernes CSS.
 * Ohne RESEND_API_KEY wird die Mail nur protokolliert (lokale Entwicklung).
 */
import { env } from 'cloudflare:workers';
import { maskieren as m } from './eingabe';
import { MAIL_LOGO_CID, mitLogoAnhang } from './mail-logo';
import type { Buchung, Nutzer, Terminart } from './typen';
import { formatDatumLang, formatSpanne, zonenName } from './zeit';

const MARKE = {
  name: "That's it. Marketing",
  schwarz: '#0E0E0E',
  orange: '#DC9832',
  gruen: '#2F8F5F',
  papier: '#FFFFFF',
  grau: '#6E6E6E',
  linie: '#E5E5E3',
  flaeche: '#F2F2EF',
  telefon: '0209 51303350',
  email: 'info@thatsit.marketing',
  web: 'thatsit.marketing',
};

export interface Anhang {
  filename: string;
  content: string; // base64
  content_type?: string;
  content_id?: string;
}

export async function mailSenden(n: { an: string | string[]; betreff: string; html: string; antwortAn?: string; anhaenge?: Anhang[] }) {
  if (!env.RESEND_API_KEY) {
    console.log(`[Mail nicht versendet, RESEND_API_KEY fehlt] an ${[n.an].flat().join(', ')}: ${n.betreff}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM || "That's it. Marketing <termine@thatsit.marketing>",
      to: n.an,
      reply_to: n.antwortAn || env.MAIL_REPLY_TO || undefined,
      subject: n.betreff,
      html: n.html,
      // Logo als eingebettetes Bild (CID) mitschicken, siehe `mail-logo.ts`.
      attachments: mitLogoAnhang(n.html, n.anhaenge),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

export function base64Utf8(text: string) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const SCHRIFT = "Montserrat, 'Helvetica Neue', Arial, sans-serif";
const DISPLAY = "'League Spartan', 'Arial Black', 'Helvetica Neue', Arial, sans-serif";

function rahmen(basis: string, vorschau: string, inhalt: string) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${m(vorschau)}</title></head>
<body style="margin:0;padding:0;background:${MARKE.flaeche};font-family:${SCHRIFT};color:${MARKE.schwarz};">
<div style="display:none;max-height:0;overflow:hidden;">${m(vorschau)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${MARKE.flaeche};padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${MARKE.papier};">
<tr><td style="background:#FFFFFF;padding:0;border-bottom:3px solid ${MARKE.schwarz};">
<a href="https://${MARKE.web}" style="display:block;text-decoration:none;"><img src="cid:${MAIL_LOGO_CID}" alt="That's it. Marketing" title="That's it. Marketing" width="600" height="88" style="display:block;border:0;width:100%;max-width:600px;height:auto;background:#FFFFFF;color:#0E0E0E;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:bold;line-height:88px;text-indent:32px;" /></a>
</td></tr>
<tr><td style="padding:36px 32px 32px;font-size:15px;line-height:1.6;">${inhalt}</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid ${MARKE.linie};font-size:12px;line-height:1.6;color:${MARKE.grau};">
${MARKE.name} &middot; Gelsenkirchen &middot; <a href="https://${MARKE.web}" style="color:${MARKE.grau};">${MARKE.web}</a> &middot; ${MARKE.telefon}
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/* Goldflaechen mit einfarbigem Verlauf als Hintergrundbild (seit 2026-10-30): Gmail auf dem iPhone kehrt
   im Dunkelmodus alle Farben um und machte aus dem Markengold ein dunkles Braunorange. Hintergrundbilder
   faerbt Gmail nicht um. */
const GOLD = `background-color:${MARKE.orange};background-image:linear-gradient(${MARKE.orange},${MARKE.orange});`;

function eyebrow(text: string) {
  return `<p style="margin:0 0 12px;font-family:'Barlow Condensed',${SCHRIFT};font-size:12px;letter-spacing:4px;text-transform:uppercase;color:${MARKE.orange};">${m(text)}</p>`;
}

function titel(text: string) {
  return `<h1 style="margin:0 0 20px;font-family:${DISPLAY};font-weight:900;font-size:30px;line-height:1.05;letter-spacing:-0.5px;color:${MARKE.schwarz};">${m(text)}<span style="display:inline-block;width:5px;height:5px;margin-left:2px;${GOLD}font-size:0;line-height:0;">&nbsp;</span></h1>`;
}

function absatz(html: string) {
  return `<p style="margin:0 0 14px;">${html}</p>`;
}

export type KnopfArt = 'orange' | 'gruen' | 'schwarz' | 'rahmen';

function knopf(href: string, text: string, art: KnopfArt = 'schwarz') {
  const stil =
    art === 'gruen'
      ? `background:${MARKE.gruen};color:#FFFFFF;border:2px solid ${MARKE.gruen};`
      : art === 'orange'
      ? `${GOLD}color:${MARKE.schwarz};border:2px solid transparent;`
      : art === 'schwarz'
        ? `background:${MARKE.schwarz};color:#FFFFFF;border:2px solid ${MARKE.schwarz};`
        : `background:#FFFFFF;color:${MARKE.schwarz};border:2px solid ${MARKE.schwarz};`;
  return `<a href="${m(href)}" style="display:inline-block;${stil}padding:12px 20px;margin:0 8px 8px 0;font-family:'Barlow Condensed',${SCHRIFT};font-weight:500;font-size:13px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;">${m(text)}</a>`;
}

export interface TerminDetails {
  terminTitel: string;
  wann: string; // bereits formatiert
  zone: string;
  dauer: number;
  gastgeber: string;
  ort?: string | null;
  meetingUrl?: string | null;
}

/** Termindaten für die Mailvorlagen, Zeiten in der Zone des Empfängers */
export function terminDetailsVon(b: Buchung, ta: Terminart, n: Nutzer, tz: string): TerminDetails {
  return {
    terminTitel: ta.titel,
    wann: `${formatDatumLang(b.start_utc, tz)}, ${formatSpanne(b.start_utc, b.ende_utc, tz)}`,
    zone: zonenName(tz),
    dauer: ta.dauer_min,
    gastgeber: /that'?s it/i.test(n.name) ? n.name : `${n.name}, That's it. Marketing`,
    ort: b.meeting_url ? null : b.ort_text,
    meetingUrl: b.meeting_url,
  };
}

function details(d: TerminDetails) {
  const zeile = (label: string, wert: string) =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid ${MARKE.linie};width:120px;vertical-align:top;font-size:13px;color:${MARKE.grau};">${label}</td><td style="padding:10px 0;border-bottom:1px solid ${MARKE.linie};font-size:15px;">${wert}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;border-top:2px solid ${MARKE.schwarz};">
${zeile('Termin', `<strong>${m(d.terminTitel)}</strong> &middot; ${d.dauer} Minuten`)}
${zeile('Wann', `${m(d.wann)}<br><span style="font-size:12px;color:${MARKE.grau};">${m(d.zone)}</span>`)}
${zeile('Mit', m(d.gastgeber))}
${d.ort ? zeile('Wo', m(d.ort)) : ''}
${d.meetingUrl ? zeile('Link', `<a href="${m(d.meetingUrl)}" style="color:${MARKE.schwarz};">${m(d.meetingUrl)}</a>`) : ''}
</table>`;
}

const vorname = (name: string) => name.trim().split(/\s+/)[0] || name;
const gruss = (zeile = 'Bis bald') => absatz(`${zeile}<br>Dein Team von ${MARKE.name}`);
const telefonFett = `<strong style="white-space:nowrap;">${MARKE.telefon}</strong>`;

/** Bestätigung an den Gast (neu oder umgebucht). Ton wie die Arbeitsabläufe: du, nahbar, konkrete Hilfe. */
export function mailGastBestaetigung(basis: string, d: TerminDetails & { gastName: string; verwaltenUrl: string; umgebucht?: boolean; zusatz?: string | null }) {
  const schritte = [
    d.umgebucht
      ? 'Die Kalenderdatei im Anhang ersetzt den alten Eintrag in deinem Kalender'
      : 'Öffne die Kalenderdatei im Anhang, dann steht der Termin direkt in deinem Kalender',
    ...(d.meetingUrl ? ['Zum Termin einfach auf „Zum Meeting“ klicken. Läuft direkt im Browser, du musst nichts installieren'] : []),
    'Du hast Links, Zahlen oder Fragen für uns? Antworte einfach auf diese Mail, sie landet direkt bei uns im Team',
  ];
  return rahmen(
    basis,
    d.umgebucht ? `Alles klar, dein neuer Termin steht: ${d.wann}` : `Wir freuen uns auf dich: ${d.terminTitel} am ${d.wann}`,
    `${eyebrow(d.umgebucht ? 'Termin umgebucht' : 'Termin bestätigt')}
${titel(d.umgebucht ? 'Dein neuer Termin steht' : 'Dein Termin steht')}
${absatz(`Hallo ${m(vorname(d.gastName))},`)}
${absatz(
  d.umgebucht
    ? 'alles klar, dein Termin ist verschoben. Wir haben uns die neue Zeit fest für dich geblockt.'
    : 'danke für deine Buchung. Wir haben uns die Zeit fest für dich geblockt und freuen uns richtig auf das Gespräch.',
)}
${details(d)}
${d.zusatz ? absatz(m(d.zusatz).replace(/\n/g, '<br>')) : ''}
<p style="margin:0 0 8px;">So geht es weiter:</p>
${liste(schritte)}
${d.meetingUrl ? knopf(d.meetingUrl, 'Zum Meeting', 'gruen') : ''}${knopf(d.verwaltenUrl, 'Umbuchen oder absagen', 'rahmen')}
<p style="margin:14px 0 14px;">Etwas dazwischengekommen? Kein Stress, über „Umbuchen oder absagen“ geht das mit zwei Klicks.</p>
${gruss()}`,
  );
}

export function mailGastgeberNeu(
  basis: string,
  d: TerminDetails & { gastName: string; gastEmail: string; gastTelefon?: string | null; antworten: { label: string; wert: string }[]; nachricht?: string | null; backofficeUrl: string; herkunft?: string | null; umgebucht?: boolean },
) {
  const extra = [
    d.herkunft ? `<p style="margin:0 0 4px;font-size:13px;color:${MARKE.grau};">Herkunft</p><p style="margin:0 0 14px;"><strong>${m(d.herkunft)}</strong></p>` : '',
    ...d.antworten.map((a) => `<p style="margin:0 0 4px;font-size:13px;color:${MARKE.grau};">${m(a.label)}</p><p style="margin:0 0 14px;white-space:pre-wrap;">${m(a.wert)}</p>`),
    d.nachricht ? `<p style="margin:0 0 4px;font-size:13px;color:${MARKE.grau};">Nachricht</p><p style="margin:0 0 14px;white-space:pre-wrap;border-left:3px solid ${MARKE.orange};padding-left:12px;">${m(d.nachricht)}</p>` : '',
  ].join('');
  return rahmen(
    basis,
    `${d.gastName} hat ${d.terminTitel} gebucht`,
    `${eyebrow(d.umgebucht ? 'Termin umgebucht' : 'Neuer Termin')}
${titel(d.umgebucht ? `${d.gastName} hat umgebucht` : `${d.gastName} hat gebucht`)}
${details({ ...d, gastgeber: `${d.gastName}, ${d.gastEmail}${d.gastTelefon ? `, ${d.gastTelefon}` : ''}` })}
${extra}
${knopf(d.backofficeUrl, 'Im Backoffice öffnen', 'schwarz')}`,
  );
}

/**
 * Absage an Gast und Büro. Der Gast bekommt je nach Absender passende Worte und immer einen Weg zurück
 * (neuer Termin, Antwort, Telefon), das Büro die Kontaktdaten und einen Tipp zum Nachfassen.
 */
export function mailStorno(
  basis: string,
  d: TerminDetails & { anName: string; grund?: string | null; vonGast: boolean; anGast: boolean; neuBuchenUrl?: string; gastEmail?: string; gastTelefon?: string | null },
) {
  const grund = d.grund
    ? `<p style="margin:0 0 4px;font-size:13px;color:${MARKE.grau};">Grund</p><p style="margin:0 0 20px;white-space:pre-wrap;border-left:3px solid ${MARKE.orange};padding-left:12px;">${m(d.grund)}</p>`
    : '';
  const neu = d.neuBuchenUrl ? knopf(d.neuBuchenUrl, 'Neuen Termin buchen', 'orange') : '';
  // Der Meetinglink eines abgesagten Termins führt nur in die Irre
  const ohneLink = { ...d, meetingUrl: null, ort: d.meetingUrl ? 'Google Meet' : d.ort };
  if (d.anGast) {
    const vonUns = !d.vonGast;
    return rahmen(
      basis,
      vonUns ? `Wir müssen deinen Termin leider absagen: ${d.terminTitel}` : `Deine Absage ist angekommen: ${d.terminTitel}`,
      `${eyebrow('Termin abgesagt')}
${titel(vonUns ? 'Wir müssen leider absagen' : 'Schade, aber kein Problem')}
${absatz(`Hallo ${m(vorname(d.anName))},`)}
${absatz(
  vonUns
    ? 'es tut uns wirklich leid, aber wir müssen deinen Termin absagen. Das ist nicht unser Anspruch und wir wollen es wiedergutmachen.'
    : 'deine Absage ist bei uns angekommen und der Termin ist aus unserem Kalender raus. Die Kalenderdatei im Anhang entfernt ihn auch aus deinem.',
)}
${details(ohneLink)}
${grund}
${absatz(
  vonUns
    ? 'Such dir direkt eine neue Zeit aus. Passt keine davon? Antworte einfach auf diese Mail, dann finden wir gemeinsam einen Termin, auch außerhalb der freien Zeiten.'
    : 'Dein Thema läuft ja nicht weg. Wenn es zeitlich wieder passt, such dir einfach eine neue Zeit aus, das dauert keine Minute.',
)}
${neu}
<p style="margin:14px 0 14px;">Lieber kurz sprechen? Antworte auf diese Mail oder ruf uns an unter ${telefonFett}.</p>
${gruss()}`,
    );
  }
  const kontakt = [d.gastEmail, d.gastTelefon].filter(Boolean).join(', ');
  return rahmen(
    basis,
    `Abgesagt: ${d.gastgeber}, ${d.terminTitel} am ${d.wann}`,
    `${eyebrow('Termin abgesagt')}
${titel(d.vonGast ? `${d.gastgeber} hat abgesagt` : 'Termin abgesagt')}
${absatz('Hallo Team,')}
${absatz(d.vonGast ? `${m(d.gastgeber)} hat den folgenden Termin abgesagt. Der Slot ist wieder frei.` : 'ihr habt den folgenden Termin abgesagt. Der Gast hat eine Mail mit Entschuldigung und Link für einen neuen Termin bekommen.')}
${details({ ...ohneLink, gastgeber: kontakt ? `${d.gastgeber}, ${kontakt}` : d.gastgeber })}
${grund}
${d.vonGast ? absatz('Tipp: Ein kurzer Anruf lohnt sich oft. Wer jetzt freundlich nachfragt, bekommt meist doch noch einen Termin.') : ''}`,
  );
}

/** Zeile aus einem Arbeitsablauf: maskiert, Links klickbar, **fett** */
function zeileHtml(text: string) {
  return m(text)
    .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}" style="color:${MARKE.schwarz};">${url}</a>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Telefonnummern nicht umbrechen
    .replace(/(\d) (?=\d)/g, '$1&nbsp;');
}

/** Liste mit orangenem Quadrat wie im Logo, als Tabelle, damit Outlook und Gmail sie gleich zeigen */
function liste(punkte: string[]) {
  const zeilen = punkte
    .map(
      (p) => `<tr><td style="width:18px;padding:9px 0 0;vertical-align:top;font-size:0;line-height:0;"><div style="width:6px;height:6px;${GOLD}font-size:0;line-height:0;">&nbsp;</div></td><td style="padding:0 0 8px;vertical-align:top;">${zeileHtml(p)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">${zeilen}</table>`;
}

/** Freier Text aus einem Arbeitsablauf: Absätze, Zeilenumbrüche, Listen mit „* “, Links klickbar, **fett** */
export function textAlsHtml(text: string) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      // Zeilen in Gruppen aus Text und Listenpunkten teilen
      const gruppen: { liste: boolean; zeilen: string[] }[] = [];
      for (const zeile of block.split('\n')) {
        const punkt = zeile.match(/^\s*[*•]\s+(.*)$/);
        const letzte = gruppen.at(-1);
        if (letzte && letzte.liste === Boolean(punkt)) letzte.zeilen.push(punkt ? punkt[1]! : zeile);
        else gruppen.push({ liste: Boolean(punkt), zeilen: [punkt ? punkt[1]! : zeile] });
      }
      return gruppen
        .map((g, i) => {
          if (g.liste) return liste(g.zeilen);
          // Einleitung direkt vor einer Liste rückt näher an sie heran
          const abstand = gruppen[i + 1]?.liste ? 8 : 14;
          return `<p style="margin:0 0 ${abstand}px;">${g.zeilen.map(zeileHtml).join('<br>')}</p>`;
        })
        .join('\n');
    })
    .join('\n');
}

/** Mail aus einem Arbeitsablauf. Text kommt vom Team, Termindaten und Knöpfe ergänzen wir automatisch. */
export function mailArbeitsablauf(
  basis: string,
  d: { vorschau: string; eyebrow: string; ueberschrift: string; text: string; details: TerminDetails | null; knoepfe: { href: string; text: string; art: KnopfArt }[] },
) {
  return rahmen(
    basis,
    d.vorschau,
    `${eyebrow(d.eyebrow)}
${d.ueberschrift ? titel(d.ueberschrift) : ''}
${textAlsHtml(d.text)}
${d.details ? details(d.details) : ''}
${d.knoepfe.map((k) => knopf(k.href, k.text, k.art)).join('')}`,
  );
}

/** Eine Nachricht aus dem WhatsApp Verlauf für die Team Mail */
export interface WaVerlaufZeile {
  von: 'lead' | 'bot' | 'team';
  name: string;
  text: string;
  zeit: string; // bereits formatiert
}

/**
 * Mail ans Team aus dem WhatsApp Bot (bitte anrufen, Team übernimmt, zur Info). Aufbau wie
 * „Neuer Termin“ an das Büro: Anlass hervorgehoben, Kontakt und Angaben als Tabelle, Verlauf als
 * Nachrichten mit Absender und Uhrzeit, Knöpfe zum Chat und zum Anrufen.
 */
export function mailWhatsappTeam(
  basis: string,
  d: {
    grund: string;
    zurInfo: boolean;
    name: string;
    firma: string | null;
    telefon: string; // mit +
    email: string | null;
    webseite: string | null;
    status: string;
    angaben: { label: string; wert: string }[];
    verlauf: WaVerlaufZeile[];
    chatUrl: string;
  },
) {
  const zeile = (label: string, wert: string) =>
    `<tr><td style="padding:10px 12px 10px 0;border-bottom:1px solid ${MARKE.linie};width:110px;vertical-align:top;font-size:13px;color:${MARKE.grau};">${label}</td><td style="padding:10px 0;border-bottom:1px solid ${MARKE.linie};font-size:15px;overflow-wrap:anywhere;">${wert}</td></tr>`;
  const tabelle = (zeilen: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;border-top:2px solid ${MARKE.schwarz};table-layout:fixed;">${zeilen}</table>`;
  const zwischentitel = (text: string) => `<p style="margin:0 0 4px;font-family:'Barlow Condensed',${SCHRIFT};font-size:12px;letter-spacing:3px;text-transform:uppercase;color:${MARKE.grau};">${m(text)}</p>`;
  const telLink = `tel:${d.telefon.replace(/[^\d+]/g, '')}`;
  const webLink = d.webseite ? (/^https?:\/\//i.test(d.webseite) ? d.webseite : `https://${d.webseite}`) : null;

  const kontakt = [
    zeile('Telefon', `<a href="${m(telLink)}" style="color:${MARKE.schwarz};white-space:nowrap;">${m(d.telefon.replace(/^\+(49|43|41)(\d{3,4})(\d+)$/, '+$1 $2 $3'))}</a>`),
    d.email ? zeile('E-Mail', `<a href="mailto:${m(d.email)}" style="color:${MARKE.schwarz};">${m(d.email)}</a>`) : '',
    webLink ? zeile('Website', `<a href="${m(webLink)}" style="color:${MARKE.schwarz};">${m(d.webseite!)}</a>`) : '',
    zeile('Status', m(d.status)),
  ].join('');
  const angaben = d.angaben.filter((a) => a.wert.trim()).map((a) => zeile(m(a.label), `<span style="white-space:pre-wrap;">${m(a.wert)}</span>`)).join('');

  // Verlauf: Lead mit orangenem Strich, Bot und Team grau. Knöpfe "[A | B]" als leise Zeile darunter
  const nachricht = (n: WaVerlaufZeile) => {
    const knoepfe = n.text.match(/\n\[([^\]]*)\]\s*$/)?.[1];
    const text = knoepfe ? n.text.replace(/\n\[[^\]]*\]\s*$/, '') : n.text;
    const lead = n.von === 'lead';
    return `<tr><td style="padding:0 0 12px;">
<div style="border-left:3px solid ${lead ? MARKE.orange : MARKE.linie};padding:2px 0 2px 12px;">
<p style="margin:0 0 2px;font-size:12px;color:${MARKE.grau};"><strong style="color:${MARKE.schwarz};">${m(n.name)}</strong> &middot; ${m(n.zeit)}</p>
<p style="margin:0;font-size:14px;line-height:1.55;white-space:pre-wrap;">${m(text.length > 600 ? `${text.slice(0, 600)} …` : text)}</p>
${knoepfe ? `<p style="margin:4px 0 0;font-size:12px;color:${MARKE.grau};">Knöpfe: ${m(knoepfe.split('|').map((k) => k.trim()).join(' · '))}</p>` : ''}
</div></td></tr>`;
  };

  return rahmen(
    basis,
    d.grund,
    `${eyebrow(d.zurInfo ? 'WhatsApp Bot · Zur Info' : 'WhatsApp Bot · Bitte übernehmen')}
${titel(d.name)}
${d.firma ? `<p style="margin:-12px 0 18px;font-size:15px;color:${MARKE.grau};">${m(d.firma)}</p>` : ''}
<p style="margin:0 0 20px;border-left:3px solid ${MARKE.orange};padding-left:12px;"><strong>${m(d.grund)}</strong></p>
${tabelle(kontakt)}
${angaben ? `${zwischentitel('Angaben aus dem Chat')}${tabelle(angaben)}` : ''}
${d.verlauf.length ? `${zwischentitel('Letzte Nachrichten')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">${d.verlauf.map(nachricht).join('')}</table>` : ''}
${knopf(d.chatUrl, 'Chat ansehen', 'schwarz')}${knopf(telLink, 'Anrufen', 'rahmen')}`,
  );
}

