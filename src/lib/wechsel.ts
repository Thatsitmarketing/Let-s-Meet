/**
 * Tool Wechsel: von einem anderen That's it. Tool nach Let's Meet (und zurück) ohne neue Anmeldung.
 * Die Prüfung der Token liegt in thatsit-link.mjs (Kopie aus dem Repo thatsit-hub), hier hängt die
 * Anbindung an Let's Meet: eigene Seiten, Konto Suche und das Merken benutzter Token.
 *
 * Bewusst ohne Import von cloudflare:workers oder der Datenbank, damit `pnpm test` es direkt laden kann.
 * Alles Zustandsbehaftete kommt über `WechselAbhaengigkeiten` herein.
 */
import { createLink, type LinkUser } from './thatsit-link.mjs';
import type { Nutzer } from './typen';

// Eigene Maskierung statt eingabe.ts, damit die Datei ohne Importendungen in `pnpm test` (Node) lädt
const maskieren = (wert: string) =>
  wert.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const APP_ID = 'meet';
export const MIN_GEHEIMNIS = 32;

/** Ohne gültiges LINK_SECRET (mindestens 32 Zeichen) gibt es den Wechsel nicht, beide Routen antworten 404. */
export const geheimGueltig = (geheim: string | undefined): geheim is string => typeof geheim === 'string' && geheim.length >= MIN_GEHEIMNIS;

export type Konto = Pick<Nutzer, 'id' | 'email' | 'name' | 'rolle'>;

export interface WechselAbhaengigkeiten {
  /** Aktives Konto mit echtem Passwort zur Mailadresse (klein geschrieben) oder null. Legt nie ein Konto an. */
  kontoSuchen(email: string): Promise<Konto | null>;
  /** Merkt die Token ID. true = erste Verwendung, false = Replay. */
  jtiMerken(jti: string, ablauf: number): Promise<boolean>;
}

/** Person für das Token. `twofa` ist nur wahr, wenn die Sitzung selbst aus einem Wechsel mit 2FA stammt. */
export function wechselNutzer(nutzer: Pick<Nutzer, 'email' | 'name' | 'rolle'>, twofa: boolean): LinkUser {
  return { email: nutzer.email, name: nutzer.name, role: nutzer.rolle === 'admin' ? 'admin' : 'member', twofa };
}

const SEITEN_STIL = `
*{box-sizing:border-box;border-radius:0}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:#0E0E0E;color:#F2EFE8;font:16px/1.55 'Montserrat',system-ui,-apple-system,'Segoe UI',sans-serif}
main{width:100%;max-width:460px;background:#1A1A1A;border-left:4px solid #C9A23A;padding:32px 28px}
.eyebrow{margin:0 0 8px;color:#DC9833;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
h1{margin:0 0 16px;font:700 28px/1.15 'League Spartan',system-ui,sans-serif;color:#fff}
h1 span{color:#DC9833}
p{margin:0 0 20px;color:#C8C8C8}
a.knopf{display:inline-block;background:#DC9833;color:#0E0E0E;font-weight:700;text-decoration:none;padding:12px 20px}
a.knopf:hover{background:#C9A23A}
a:focus-visible{outline:2px solid #C9A23A;outline-offset:3px}
`;

const KOPF = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
};

function seite(status: number, titel: string, text: string, knopf?: { href: string; text: string }) {
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${maskieren(titel)} | Let's Meet</title><style>${SEITEN_STIL}</style></head><body><main><p class="eyebrow">Tool Wechsel</p><h1>${maskieren(titel)}<span>.</span></h1><p>${maskieren(text)}</p>${knopf ? `<a class="knopf" href="${maskieren(knopf.href)}">${maskieren(knopf.text)}</a>` : ''}</main></body></html>`;
  return new Response(html, { status, headers: KOPF });
}

/**
 * Leitet über eine kleine Seite statt per 302 weiter. Die Person kommt aus einem anderen Tool, also
 * zählt die Navigation als seitenübergreifend und das Strict Cookie `lm_sitzung` würde bei einem 302
 * auf der Zielseite fehlen (Folge: Loginmaske). Die Weiterleitung per meta refresh startet auf unserer
 * Domain, dann kommt das eben gesetzte Cookie mit. Gleiche Lösung wie beim Google Rückruf.
 */
function weiterleitungsseite(ziel: string) {
  const z = maskieren(ziel);
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><meta http-equiv="refresh" content="0;url=${z}"><title>Weiterleitung | Let's Meet</title><style>${SEITEN_STIL}</style></head><body><main><p class="eyebrow">Tool Wechsel</p><h1>Einen Moment<span>.</span></h1><p>Du wirst zu Let's Meet weitergeleitet.</p><a class="knopf" href="${z}">Weiter</a></main></body></html>`;
  return new Response(html, { status: 200, headers: KOPF });
}

/** Nach dem Wechsel geht es nur ins Backoffice, nie auf eine öffentliche Seite oder eine fremde Adresse. */
export function wechselZiel(next: string) {
  return /^\/app(?:[/?#]|$)/.test(next) && !next.startsWith('/app//') ? next : '/app';
}

/** GET /auth/switch?to=<id>: Token ausstellen und zum Zieltool schicken. `sitzung` ist null ohne Anmeldung. */
export async function wechselAusgang(
  geheim: string | undefined,
  anfrage: Request,
  sitzung: { nutzer: Pick<Nutzer, 'email' | 'name' | 'rolle'>; twofa: boolean } | null,
): Promise<Response> {
  if (!geheimGueltig(geheim)) return new Response('Nicht gefunden', { status: 404, headers: { 'cache-control': 'no-store' } });
  const link = createLink({ appId: APP_ID, secret: geheim, resolveUser: async () => null });
  const antwort = await link.out(anfrage, sitzung ? wechselNutzer(sitzung.nutzer, sitzung.twofa) : null);
  if (antwort.status === 302) {
    // Response.redirect liefert unveränderliche Header, die Middleware setzt aber weitere
    return new Response(null, { status: 302, headers: { location: antwort.headers.get('location') ?? '/app', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  }
  if (antwort.status === 401 || antwort.status === 403) {
    return seite(
      antwort.status,
      'Wechseln geht noch nicht',
      'Zum Wechseln melde dich bitte einmal in einem Tool mit 2FA an, zum Beispiel im Lead System. Danach kommst du hier mit einem Klick im Tool Menü hin und zurück.',
      { href: sitzung ? '/app' : '/app/login', text: sitzung ? 'Zurück ins Backoffice' : 'Zur Anmeldung' },
    );
  }
  return seite(404, 'Tool nicht gefunden', 'Dieses Tool kenne ich nicht. Nimm bitte den Eintrag aus dem Tool Menü.', { href: '/app', text: 'Zurück ins Backoffice' });
}

/**
 * GET /auth/switch/in?token=...: Token prüfen, Konto suchen, `sitzungStarten` setzt das Cookie.
 * Die Rolle bleibt die lokale aus dem Konto, nicht die aus dem Token.
 */
export async function wechselEingang(
  geheim: string | undefined,
  anfrage: Request,
  deps: WechselAbhaengigkeiten,
  sitzungStarten: (konto: Konto) => Promise<void>,
): Promise<Response> {
  if (!geheimGueltig(geheim)) return new Response('Nicht gefunden', { status: 404, headers: { 'cache-control': 'no-store' } });
  const link = createLink({
    appId: APP_ID,
    secret: geheim,
    seenJti: deps.jtiMerken,
    resolveUser: async (u) => {
      const konto = await deps.kontoSuchen(u.email.toLowerCase());
      return konto ? { ...konto } : null;
    },
  });
  const antwort = await link.in(anfrage, {
    startSession: async (konto: Konto, next: string) => {
      await sitzungStarten(konto);
      return weiterleitungsseite(wechselZiel(next));
    },
  });
  if (antwort.status === 200) return antwort;
  if (antwort.status === 403) {
    return seite(403, 'Kein Konto in Let\'s Meet', 'Für deine Mailadresse gibt es in Let\'s Meet kein aktives Konto. Bitte einen Admin, dich unter Team anzulegen. Wechseln darfst du danach mit einem Klick.');
  }
  return seite(401, 'Wechsel abgelehnt', 'Der Wechsel ist abgelaufen oder wurde schon benutzt. Klick im anderen Tool bitte noch einmal auf Let\'s Meet.');
}
