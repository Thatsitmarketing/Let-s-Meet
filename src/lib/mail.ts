/**
 * Mailversand über Resend und Vorlagen im Branding von That's it. Marketing.
 * Tabellenlayout und Inlinestile sind Absicht, Mailprogramme können kein modernes CSS.
 * Ohne RESEND_API_KEY wird die Mail nur protokolliert (lokale Entwicklung).
 */
import { env } from 'cloudflare:workers';
import { maskieren as m } from './eingabe';

const MARKE = {
  name: "That's it. Marketing",
  schwarz: '#0E0E0E',
  orange: '#DC9832',
  papier: '#FFFFFF',
  grau: '#6E6E6E',
  linie: '#E5E5E3',
  flaeche: '#F2F2EF',
  telefon: '0209 36660644',
  email: 'info@thatsit.marketing',
  web: 'thatsit.marketing',
};

export interface Anhang {
  filename: string;
  content: string; // base64
  content_type?: string;
}

export async function mailSenden(n: { an: string; betreff: string; html: string; antwortAn?: string; anhaenge?: Anhang[] }) {
  if (!env.RESEND_API_KEY) {
    console.log(`[Mail nicht versendet, RESEND_API_KEY fehlt] an ${n.an}: ${n.betreff}`);
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
      attachments: n.anhaenge,
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
<tr><td style="background:${MARKE.schwarz};padding:24px 32px;">
<img src="${basis}/images/brand/letsmeet-kompakt-weiss.png" alt="Let's Meet." title="Let's Meet. That's it. Marketing" width="200" height="34" style="display:block;border:0;width:200px;height:34px;" />
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

function eyebrow(text: string) {
  return `<p style="margin:0 0 12px;font-family:'Barlow Condensed',${SCHRIFT};font-size:12px;letter-spacing:4px;text-transform:uppercase;color:${MARKE.orange};">${m(text)}</p>`;
}

function titel(text: string) {
  return `<h1 style="margin:0 0 20px;font-family:${DISPLAY};font-weight:900;font-size:30px;line-height:1.05;letter-spacing:-0.5px;color:${MARKE.schwarz};">${m(text)}<span style="color:${MARKE.orange};">.</span></h1>`;
}

function absatz(html: string) {
  return `<p style="margin:0 0 14px;">${html}</p>`;
}

function knopf(href: string, text: string, art: 'orange' | 'schwarz' | 'rahmen' = 'schwarz') {
  const stil =
    art === 'orange'
      ? `background:${MARKE.orange};color:${MARKE.schwarz};border:2px solid ${MARKE.orange};`
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

export function mailGastBestaetigung(basis: string, d: TerminDetails & { gastName: string; verwaltenUrl: string; umgebucht?: boolean; zusatz?: string | null }) {
  return rahmen(
    basis,
    `${d.terminTitel} am ${d.wann}`,
    `${eyebrow(d.umgebucht ? 'Termin umgebucht' : 'Termin bestätigt')}
${titel(d.umgebucht ? 'Dein neuer Termin steht' : 'Dein Termin steht')}
${absatz(`Hallo ${m(d.gastName)},`)}
${absatz(d.umgebucht ? 'du hast deinen Termin verschoben. Hier sind die neuen Daten. Die Kalenderdatei im Anhang ersetzt den alten Eintrag.' : 'danke für deine Buchung. Hier sind alle Daten auf einen Blick. Die Kalenderdatei im Anhang kannst du direkt übernehmen.')}
${details(d)}
${d.zusatz ? absatz(m(d.zusatz).replace(/\n/g, '<br>')) : ''}
${d.meetingUrl ? knopf(d.meetingUrl, 'Zum Meeting', 'orange') : ''}${knopf(d.verwaltenUrl, 'Umbuchen oder absagen', 'rahmen')}
${absatz(`<span style="font-size:13px;color:${MARKE.grau};">Fragen vorab? Antworte einfach auf diese Mail.</span>`)}`,
  );
}

export function mailGastgeberNeu(
  basis: string,
  d: TerminDetails & { gastName: string; gastEmail: string; gastTelefon?: string | null; antworten: { label: string; wert: string }[]; nachricht?: string | null; backofficeUrl: string; umgebucht?: boolean },
) {
  const extra = [
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

export function mailStorno(basis: string, d: TerminDetails & { anName: string; grund?: string | null; vonGast: boolean; anGast: boolean; neuBuchenUrl?: string }) {
  const wer = d.vonGast ? (d.anGast ? 'Du hast' : `${d.gastgeber} hat`) : d.anGast ? `${d.gastgeber} hat` : 'Du hast';
  return rahmen(
    basis,
    `Abgesagt: ${d.terminTitel} am ${d.wann}`,
    `${eyebrow('Termin abgesagt')}
${titel('Termin abgesagt')}
${absatz(`Hallo ${m(d.anName)},`)}
${absatz(`${m(wer)} den folgenden Termin abgesagt.`)}
${details(d)}
${d.grund ? `<p style="margin:0 0 4px;font-size:13px;color:${MARKE.grau};">Grund</p><p style="margin:0 0 20px;white-space:pre-wrap;border-left:3px solid ${MARKE.orange};padding-left:12px;">${m(d.grund)}</p>` : ''}
${d.neuBuchenUrl ? knopf(d.neuBuchenUrl, 'Neuen Termin buchen', 'orange') : ''}`,
  );
}

export function mailErinnerung(basis: string, d: TerminDetails & { gastName: string; verwaltenUrl: string; wannRelativ: string }) {
  return rahmen(
    basis,
    `Erinnerung: ${d.terminTitel} ${d.wannRelativ}`,
    `${eyebrow('Erinnerung')}
${titel(`Wir sehen uns ${d.wannRelativ}`)}
${absatz(`Hallo ${m(d.gastName)},`)}
${absatz('kurze Erinnerung an deinen Termin. Falls etwas dazwischenkommt, buche einfach um.')}
${details(d)}
${d.meetingUrl ? knopf(d.meetingUrl, 'Zum Meeting', 'orange') : ''}${knopf(d.verwaltenUrl, 'Umbuchen oder absagen', 'rahmen')}`,
  );
}
