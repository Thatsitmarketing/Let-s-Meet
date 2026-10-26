/** Kalenderdatei nach RFC 5545 für Mailanhang und Download. */

function icsZeit(iso: string) {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsText(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

/** Zeilen über 75 Oktette werden nach RFC 5545 gefaltet. */
function falten(zeile: string) {
  const teile: string[] = [];
  let rest = zeile;
  while (rest.length > 74) {
    teile.push(rest.slice(0, 74));
    rest = ' ' + rest.slice(74);
  }
  teile.push(rest);
  return teile.join('\r\n');
}

export function icsDatei(d: {
  uid: string;
  titel: string;
  beschreibung: string;
  start: string;
  ende: string;
  ort?: string | null;
  url?: string | null;
  veranstalterName: string;
  veranstalterEmail: string;
  gastName: string;
  gastEmail: string;
  storniert?: boolean;
}) {
  const zeilen = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    "PRODID:-//That's it. Marketing//Let's Meet//DE",
    'CALSCALE:GREGORIAN',
    `METHOD:${d.storniert ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:${d.uid}@lets-meet`,
    `DTSTAMP:${icsZeit(new Date().toISOString())}`,
    `DTSTART:${icsZeit(d.start)}`,
    `DTEND:${icsZeit(d.ende)}`,
    `SUMMARY:${icsText(d.titel)}`,
    `DESCRIPTION:${icsText(d.beschreibung)}`,
    d.ort ? `LOCATION:${icsText(d.ort)}` : '',
    d.url ? `URL:${d.url}` : '',
    `ORGANIZER;CN=${icsText(d.veranstalterName)}:mailto:${d.veranstalterEmail}`,
    `ATTENDEE;CN=${icsText(d.gastName)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:${d.gastEmail}`,
    `STATUS:${d.storniert ? 'CANCELLED' : 'CONFIRMED'}`,
    `SEQUENCE:${d.storniert ? 1 : 0}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return zeilen.map(falten).join('\r\n') + '\r\n';
}

export function googleKalenderLink(d: { titel: string; start: string; ende: string; beschreibung: string; ort?: string | null }) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: d.titel,
    dates: `${icsZeit(d.start)}/${icsZeit(d.ende)}`,
    details: d.beschreibung,
    location: d.ort ?? '',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

export function outlookKalenderLink(d: { titel: string; start: string; ende: string; beschreibung: string; ort?: string | null }) {
  const p = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: d.titel,
    startdt: d.start,
    enddt: d.ende,
    body: d.beschreibung,
    location: d.ort ?? '',
  });
  return `https://outlook.office.com/calendar/0/deeplink/compose?${p}`;
}
