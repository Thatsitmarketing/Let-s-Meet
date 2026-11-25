/**
 * Tests des Tool Wechsels (src/lib/wechsel.ts, src/lib/thatsit-link.mjs, src/lib/sitzung-wert.ts).
 * Läuft ohne Abhängigkeiten: `pnpm test` (node --test). Datenbank und Cookies werden durch
 * einfache Ersatzobjekte ersetzt, geprüft wird die echte Token Logik.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLink, signToken } from '../src/lib/thatsit-link.mjs';
import { geheimGueltig, wechselAusgang, wechselEingang, wechselNutzer, wechselZiel, zweiFaktorPflicht, type Konto } from '../src/lib/wechsel.ts';
import { sitzungWertBauen, sitzungWertLesen } from '../src/lib/sitzung-wert.ts';

const GEHEIM = 'gemeinsames-verbund-geheimnis-mit-mehr-als-32-zeichen';
const MAIL = 'victor@thatsit.marketing';
const konto: Konto = { id: 'u1', email: MAIL, name: 'Victor Lokal', rolle: 'mitglied' };

// Das Lead System als Ausgangstool, mit eigener 2FA
const leads = createLink({ appId: 'scraper', secret: GEHEIM, allowedEmails: MAIL });
const victor = { email: MAIL, name: 'Victor', role: 'admin', twofa: true };

async function tokenUrl(patch: Record<string, unknown> = {}, secret = GEHEIM, next = '') {
  const t = Math.floor(Date.now() / 1000);
  const token = await signToken(secret, {
    typ: 'switch', iss: 'scraper', aud: 'meet', email: MAIL, name: 'Victor', role: 'admin',
    amr: ['pwd', 'otp'], iat: t, exp: t + 60, jti: Math.random().toString(36), ...patch,
  });
  return `https://letsmeet.thatsit.marketing/auth/switch/in?token=${token}${next}`;
}

function umgebung(konten: Konto[] = [konto]) {
  const benutzt = new Set<string>();
  const gestartet: Konto[] = [];
  return {
    gestartet,
    deps: {
      kontoSuchen: async (email: string) => konten.find((k) => k.email === email) ?? null,
      jtiMerken: async (jti: string) => (benutzt.has(jti) ? false : (benutzt.add(jti), true)),
    },
    starten: async (k: Konto, _twofa?: boolean) => { gestartet.push(k); },
  };
}

const rein = (url: string, u = umgebung(), geheim: string | undefined | null = GEHEIM, streng = false) =>
  wechselEingang(geheim === null ? undefined : geheim, new Request(url), u.deps, u.starten, streng);

test('Gültiges Token: Konto gefunden, Sitzung gestartet, lokale Rolle bleibt, Weiterleitung per meta refresh', async () => {
  const u = umgebung();
  const antwort = await rein(await tokenUrl({ role: 'admin' }, GEHEIM, '&next=%2Fapp%2Ftermine'), u);
  assert.equal(antwort.status, 200, 'kein 302, sonst fehlt das Strict Cookie auf der Zielseite');
  assert.equal(antwort.headers.get('location'), null);
  const html = await antwort.text();
  assert.match(html, /http-equiv="refresh" content="0;url=\/app\/termine"/);
  assert.equal(u.gestartet.length, 1);
  assert.equal(u.gestartet[0].id, 'u1');
  assert.equal(u.gestartet[0].rolle, 'mitglied', 'Rolle kommt aus dem Konto, nicht aus dem Token (dort admin)');
});

test('Rückleitung nur ins Backoffice, nie auf Fremdes oder öffentliche Seiten', async () => {
  assert.equal(wechselZiel('/app/kontakte?x=1'), '/app/kontakte?x=1');
  for (const schlecht of ['/', '/erstgespraech', '//evil.de', 'https://evil.de', '/appx', '/app//evil.de', '']) assert.equal(wechselZiel(schlecht), '/app');
  const html = await (await rein(await tokenUrl({}, GEHEIM, '&next=%2F%22%3E%3Cscript%3E'))).text();
  assert.match(html, /url=\/app"/, 'fremder Pfad wird zu /app');
  assert.doesNotMatch(html, /<script>/);
});

test('Fremdes Secret wird abgelehnt, keine Sitzung', async () => {
  const u = umgebung();
  const antwort = await rein(await tokenUrl({}, 'ein-ganz-anderes-geheimnis-mit-vielen-zeichen'), u);
  assert.equal(antwort.status, 401);
  assert.equal(u.gestartet.length, 0);
});

test('Abgelaufenes Token wird abgelehnt', async () => {
  const u = umgebung();
  const t = Math.floor(Date.now() / 1000);
  assert.equal((await rein(await tokenUrl({ iat: t - 120, exp: t - 60 }), u)).status, 401);
  assert.equal(u.gestartet.length, 0);
});

test('Falscher Empfänger: Token für ein anderes Tool gilt hier nicht', async () => {
  const u = umgebung();
  assert.equal((await rein(await tokenUrl({ aud: 'crm' }), u)).status, 401);
  assert.equal(u.gestartet.length, 0);
});

test('Replay: dasselbe Token geht nur einmal', async () => {
  const u = umgebung();
  const url = await tokenUrl();
  assert.equal((await rein(url, u)).status, 200);
  assert.equal((await rein(url, u)).status, 401);
  assert.equal(u.gestartet.length, 1);
});

test('Unbekannte Mailadresse: 403 und es wird kein Konto angelegt', async () => {
  const u = umgebung();
  const antwort = await rein(await tokenUrl({ email: 'fremd@example.com' }), u);
  assert.equal(antwort.status, 403);
  assert.match(await antwort.text(), /kein aktives Konto/);
  assert.equal(u.gestartet.length, 0);
});

test('Groß und Kleinschreibung der Mailadresse spielt keine Rolle', async () => {
  const u = umgebung();
  assert.equal((await rein(await tokenUrl({ email: 'Victor@ThatsIt.Marketing' }), u)).status, 200);
  assert.equal(u.gestartet.length, 1);
});

test('Standard: Token ohne 2FA Beleg (amr pwd) startet eine Sitzung, ohne amr nicht', async () => {
  const u = umgebung();
  assert.equal((await rein(await tokenUrl({ amr: ['pwd'] }), u)).status, 200);
  assert.equal((await rein(await tokenUrl({ amr: undefined }), u)).status, 401);
  assert.equal(u.gestartet.length, 1);
});

test('Strenger Modus (require2fa): ohne 2FA Beleg im Token keine Sitzung', async () => {
  const u = umgebung();
  assert.equal((await rein(await tokenUrl({ amr: ['pwd'] }), u, GEHEIM, true)).status, 401);
  assert.equal((await rein(await tokenUrl({ amr: undefined }), u, GEHEIM, true)).status, 401);
  assert.equal(u.gestartet.length, 0);
  assert.equal((await rein(await tokenUrl({ amr: ['pwd', 'otp'] }), u, GEHEIM, true)).status, 200);
});

test('Sitzung trägt das 2FA Flag nur, wenn das Token einen Beleg hatte', async () => {
  const flags: boolean[] = [];
  const u = umgebung();
  for (const amr of [['pwd'], ['pwd', 'otp']]) {
    const url = await tokenUrl({ amr });
    await wechselEingang(GEHEIM, new Request(url), u.deps, async (_k, twofa) => { flags.push(twofa); });
  }
  assert.deepEqual(flags, [false, true]);
  assert.equal(zweiFaktorPflicht('1'), true);
  assert.equal(zweiFaktorPflicht(undefined), false);
  assert.equal(zweiFaktorPflicht('0'), false);
});

test('Andere Tokentypen (App zu App) und das eigene Tool als Aussteller werden abgelehnt', async () => {
  const u = umgebung();
  assert.equal((await rein(await tokenUrl({ typ: 'service' }), u)).status, 401);
  assert.equal((await rein(await tokenUrl({ iss: 'meet' }), u)).status, 401);
  assert.equal(u.gestartet.length, 0);
});

test('Ohne LINK_SECRET oder mit zu kurzem Secret antworten beide Routen mit 404', async () => {
  for (const geheim of [null, '', 'zu-kurz']) {
    assert.equal(geheimGueltig(geheim ?? undefined), false);
    assert.equal((await rein(await tokenUrl(), umgebung(), geheim)).status, 404);
    const sitzung = { nutzer: konto, twofa: true };
    assert.equal((await wechselAusgang(geheim ?? undefined, new Request('https://x.test/auth/switch?to=scraper'), sitzung)).status, 404);
  }
  assert.equal(geheimGueltig(GEHEIM), true);
});

test('Standard: Ausgang ohne 2FA Beleg stellt direkt ein Token aus (amr pwd), kein Umweg', async () => {
  const ohne = { nutzer: konto, twofa: false };
  const zuCrm = await wechselAusgang(GEHEIM, new Request('https://x.test/auth/switch?to=crm&next=%2Fleads'), ohne);
  assert.equal(zuCrm.status, 302);
  const l = new URL(zuCrm.headers.get('location')!);
  assert.equal(l.pathname, '/auth/switch/in');
  assert.notEqual(l.origin, 'https://leads.thatsit.marketing');
  const crm = createLink({ appId: 'crm', secret: GEHEIM, allowedEmails: MAIL });
  let gesehen: any;
  assert.equal((await crm.in(new Request(l), { startSession: async (u) => { gesehen = u; return new Response('ok'); } })).status, 200);
  assert.equal(gesehen.email, MAIL);
  const zuLead = await wechselAusgang(GEHEIM, new Request('https://x.test/auth/switch?to=scraper'), ohne);
  assert.equal(new URL(zuLead.headers.get('location')!).pathname, '/auth/switch/in');
  const strengesZiel = createLink({ appId: 'crm', secret: GEHEIM, allowedEmails: MAIL, require2fa: true });
  assert.equal((await strengesZiel.in(new Request(l), { startSession: async () => new Response('ok') })).status, 401, 'strenges Zieltool lehnt Token ohne otp ab');
});

test('Strenger Modus: Ausgang ohne 2FA Beleg der Sitzung führt über das Lead System, kein Token', async () => {
  const ohne = { nutzer: konto, twofa: false };
  const zuCrm = await wechselAusgang(GEHEIM, new Request('https://x.test/auth/switch?to=crm&next=%2Fleads'), ohne, true);
  assert.equal(zuCrm.status, 302);
  zuCrm.headers.set('x-test', '1'); // Header müssen veränderbar sein, die Middleware setzt weitere
  const l = new URL(zuCrm.headers.get('location')!);
  assert.equal(l.origin + l.pathname, 'https://leads.thatsit.marketing/auth/switch');
  assert.equal(l.searchParams.get('to'), 'crm');
  assert.equal(l.searchParams.get('next'), '/leads');
  assert.equal(l.searchParams.get('token'), null);
  const zuLead = await wechselAusgang(GEHEIM, new Request('https://x.test/auth/switch?to=scraper'), ohne, true);
  assert.equal(zuLead.status, 302);
  assert.equal(zuLead.headers.get('location'), 'https://leads.thatsit.marketing/');
  assert.doesNotMatch(zuLead.headers.get('location')!, /token=/);
});

test('Ausgang ohne Anmeldung: 401 mit Link zur Anmeldung', async () => {
  const antwort = await wechselAusgang(GEHEIM, new Request('https://x.test/auth/switch?to=scraper'), null);
  assert.equal(antwort.status, 401);
  assert.match(await antwort.text(), /href="\/app\/login"/);
});

test('Ausgang mit 2FA Sitzung: Token geht an das Zieltool und wird dort angenommen', async () => {
  const antwort = await wechselAusgang(GEHEIM, new Request('https://x.test/auth/switch?to=scraper&next=%2Fleads'), { nutzer: konto, twofa: true });
  assert.equal(antwort.status, 302);
  antwort.headers.set('x-test', '1'); // Header müssen veränderbar sein, die Middleware setzt weitere
  const ziel = new URL(antwort.headers.get('location')!);
  assert.equal(ziel.origin, 'https://leads.thatsit.marketing');
  assert.equal(ziel.pathname, '/auth/switch/in');
  const lead = createLink({ appId: 'scraper', secret: GEHEIM, allowedEmails: MAIL });
  let gesehen: any;
  const r = await lead.in(new Request(ziel), { startSession: async (u) => { gesehen = u; return new Response('ok'); } });
  assert.equal(r.status, 200);
  assert.equal(gesehen.email, MAIL);
  assert.equal(gesehen.role, 'member');
});

test('Ausgang: unbekanntes Ziel und das eigene Tool geben 404', async () => {
  for (const ziel of ['gibtsnicht', 'meet', '']) {
    const antwort = await wechselAusgang(GEHEIM, new Request(`https://x.test/auth/switch?to=${ziel}`), { nutzer: konto, twofa: true });
    assert.equal(antwort.status, 404);
  }
});

test('Das Token aus dem Lead System kommt hier an (Gegenprobe mit dem Ausgang der Vorlage)', async () => {
  const dest = (await leads.out(new Request('https://leads.thatsit.marketing/auth/switch?to=meet&next=%2Fapp%2Ftermine'), victor)).headers.get('location')!;
  assert.match(dest, /^https:\/\/letsmeet\.thatsit\.marketing\/auth\/switch\/in\?/);
  const u = umgebung();
  const antwort = await rein(dest, u);
  assert.equal(antwort.status, 200);
  assert.equal(u.gestartet[0].email, MAIL);
});

test('Person fürs Token: twofa nur, wenn die Sitzung es belegt; Rolle mitglied wird member', () => {
  assert.deepEqual(wechselNutzer(konto, false), { email: MAIL, name: 'Victor Lokal', role: 'member', twofa: false });
  assert.equal(wechselNutzer({ ...konto, rolle: 'admin' }, true).role, 'admin');
  assert.equal(wechselNutzer(konto, true).twofa, true);
});

test('Sitzungswert: Flag 2fa nur nach Wechsel, alte Cookies ohne Flag bleiben gültig', () => {
  assert.equal(sitzungWertBauen('u1', 123), 'u1|123');
  assert.equal(sitzungWertBauen('u1', 123, true), 'u1|123|2fa');
  assert.deepEqual(sitzungWertLesen('u1|123'), { id: 'u1', ablauf: 123, twofa: false });
  assert.deepEqual(sitzungWertLesen('u1|123|2fa'), { id: 'u1', ablauf: 123, twofa: true });
  assert.equal(sitzungWertLesen('u1|123|egal')?.twofa, false);
  assert.equal(sitzungWertLesen('|123'), null);
  assert.equal(sitzungWertLesen('u1|abc'), null);
});
