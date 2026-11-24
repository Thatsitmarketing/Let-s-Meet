// thatsit-link.mjs: Wechsel zwischen den That's it. Tools ohne neue Anmeldung.
// Diese Datei wird in jedes Repo kopiert (Quelle: Repo thatsit-hub, scripts/build.mjs erzeugt sie). Keine Abhängigkeiten.
//
// Idee: Es gibt kein zentrales System. Wer sich in einem Tool angemeldet hat (mit 2FA), kann von dort in jedes andere
// Tool wechseln. Das Ausgangstool stellt ein 60 Sekunden gültiges, signiertes Token aus, das Zieltool prüft es und
// startet seine eigene Session. Die 2FA wird also nur dort abgefragt, wo man sich zuerst anmeldet.
//
//   const link = createLink({ appId: 'seo', secret: env.LINK_SECRET, allowedEmails: env.LINK_ALLOWED });
//   GET /auth/switch     ->  link.out(request, user)   user = { email, name, role, twofa: true } oder null
//   GET /auth/switch/in  ->  link.in(request, { startSession })
export const APPS = [
  {
    "id": "projekte",
    "name": "Projekte",
    "long": "Webdesign CRM, Projektmanagement",
    "url": "https://projekte.thatsit.marketing",
    "confirmed": false
  },
  {
    "id": "meet",
    "name": "Let's Meet",
    "long": "Terminbuchung und WhatsApp Bot",
    "url": "https://meet.thatsit.marketing",
    "confirmed": false
  },
  {
    "id": "sales-helper",
    "name": "Sales Helper",
    "long": "KI Assistent für Live Calls",
    "url": "https://ki-sales-helper.aged-brook-9137.workers.dev",
    "confirmed": true
  },
  {
    "id": "seo",
    "name": "SEO",
    "long": "That's it SEO (OpenSEO)",
    "url": "https://seo.thatsit.marketing",
    "confirmed": true
  },
  {
    "id": "crm",
    "name": "CRM",
    "long": "Closed CRM",
    "url": "https://crm.thatsit.marketing",
    "confirmed": false
  },
  {
    "id": "scraper",
    "name": "Lead Scraper",
    "long": "Lead System, Suche und Analyse",
    "url": "https://leads.thatsit.marketing",
    "confirmed": true
  }
];

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64u = {
  enc(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const s = atob(str);
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};
const hmacKey = (secret, usage) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
const part = (o) => b64u.enc(enc.encode(JSON.stringify(o)));
const rid = (n = 12) => b64u.enc(crypto.getRandomValues(new Uint8Array(n)));

export async function signToken(secret, payload) {
  const h = part({ alg: 'HS256', typ: 'JWT' });
  const p = part(payload);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(`${h}.${p}`)));
  return `${h}.${p}.${b64u.enc(sig)}`;
}

export async function verifyToken(secret, token, { typ, aud, now = Math.floor(Date.now() / 1000) } = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Token Format ungültig');
  const [h, p, s] = parts;
  if (JSON.parse(dec.decode(b64u.dec(h))).alg !== 'HS256') throw new Error('Algorithmus nicht erlaubt');
  if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), b64u.dec(s), enc.encode(`${h}.${p}`)))) throw new Error('Signatur ungültig');
  const c = JSON.parse(dec.decode(b64u.dec(p)));
  if (typeof c.exp !== 'number' || c.exp <= now) throw new Error('Token abgelaufen');
  if (c.iat > now + 30) throw new Error('Token aus der Zukunft');
  if (typ && c.typ !== typ) throw new Error('Tokentyp falsch');
  if (aud && c.aud !== aud) throw new Error('Empfänger falsch');
  return c;
}

// Nur relative Pfade zulassen, damit der Rücksprung kein Open Redirect wird.
export const safeNext = (n) => (typeof n === 'string' && /^\/(?![\/\\])/.test(n) ? n : '/');

export function createLink({ appId, secret, allowedEmails, resolveUser, urls = {}, seenJti, now = () => Math.floor(Date.now() / 1000) }) {
  if (!appId || !secret) throw new Error('appId und secret sind Pflicht');
  if (!allowedEmails && !resolveUser) throw new Error('allowedEmails oder resolveUser setzen: sonst käme jeder mit gültigem Token rein');
  const apps = APPS.map((a) => ({ ...a, url: (urls[a.id] || a.url).replace(/\/$/, '') }));
  const allowed = typeof allowedEmails === 'string' ? allowedEmails.split(',') : allowedEmails;
  const allowSet = allowed && new Set(allowed.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const used = new Map();

  async function firstUse(jti, exp) {
    if (seenJti) return seenJti(jti, exp);
    for (const [k, e] of used) if (e < now()) used.delete(k);
    if (used.has(jti)) return false;
    used.set(jti, exp);
    return true;
  }

  return {
    apps,
    // Ausgang: nur für angemeldete Nutzer, die ihre 2FA in diesem Tool bestanden haben.
    async out(request, user) {
      const u = new URL(request.url);
      const target = apps.find((a) => a.id === u.searchParams.get('to'));
      if (!target || target.id === appId) return new Response('Unbekanntes Ziel', { status: 404 });
      if (!user || !user.email) return new Response('Nicht angemeldet', { status: 401 });
      if (user.twofa !== true) return new Response('2FA fehlt, Wechsel nicht möglich', { status: 403 });
      const t = now();
      const token = await signToken(secret, {
        typ: 'switch', iss: appId, aud: target.id, email: user.email, name: user.name || user.email, role: user.role || 'member',
        amr: ['pwd', 'otp'], iat: t, exp: t + 60, jti: rid(),
      });
      const dest = new URL('/auth/switch/in', target.url);
      dest.searchParams.set('token', token);
      dest.searchParams.set('next', safeNext(u.searchParams.get('next')));
      return Response.redirect(dest.toString(), 302);
    },
    // Eingang: Token prüfen, Person freigeben, dann die eigene Session des Tools starten.
    async in(request, { startSession }) {
      const u = new URL(request.url);
      let c;
      try {
        c = await verifyToken(secret, u.searchParams.get('token'), { typ: 'switch', aud: appId, now: now() });
        if (!apps.some((a) => a.id === c.iss) || c.iss === appId) throw new Error('Aussteller unbekannt');
        if (!Array.isArray(c.amr) || !c.amr.includes('otp')) throw new Error('2FA Beleg fehlt');
        if (!(await firstUse(c.jti, c.exp))) throw new Error('Token wurde schon benutzt');
      } catch (e) {
        return new Response(`Wechsel abgelehnt: ${e.message}`, { status: 401 });
      }
      const email = String(c.email).toLowerCase();
      let user = { email, name: c.name, role: c.role };
      if (allowSet && !allowSet.has(email)) return new Response('Für dieses Tool nicht freigegeben', { status: 403 });
      if (resolveUser) {
        user = await resolveUser(user);
        if (!user) return new Response('Für dieses Tool nicht freigegeben', { status: 403 });
      }
      return startSession(user, safeNext(u.searchParams.get('next')));
    },
    // Für Tools ohne eigene Session Verwaltung: signiertes Cookie, 12 Stunden.
    cookieSession({ secret: sessionSecret, name = `ti_${appId.replace(/\W/g, '_')}` }) {
      const set = (v, age) => `${name}=${encodeURIComponent(v)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
      return {
        async start(user, next) {
          const t = now();
          const v = await signToken(sessionSecret, { typ: 'session', ...user, twofa: true, iat: t, exp: t + 12 * 3600 });
          return new Response(null, { status: 302, headers: { Location: next, 'Set-Cookie': set(v, 12 * 3600) } });
        },
        async read(request) {
          const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
          if (!m) return null;
          try {
            const c = await verifyToken(sessionSecret, decodeURIComponent(m[1]), { typ: 'session', now: now() });
            return { email: c.email, name: c.name, role: c.role, twofa: true };
          } catch {
            return null;
          }
        },
        clear: () => set('', 0),
      };
    },
  };
}

// ---- App zu App (Datenaustausch), gleiches Geheimnis, eigener Tokentyp ----
export async function callApp({ secret, from, to, path, method = 'POST', body, fetchImpl = fetch }) {
  const t = Math.floor(Date.now() / 1000);
  const token = await signToken(secret, { typ: 'service', iss: from, aud: to.id, iat: t, exp: t + 60, jti: rid(8) });
  const res = await fetchImpl(new URL(path, to.url), {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${to.id} antwortete ${res.status}`);
  return res.json();
}

export async function requireService(request, { secret, appId, now }) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer (.+)$/);
  if (!m) throw new Error('Authorization fehlt');
  const c = await verifyToken(secret, m[1], { typ: 'service', aud: appId, now });
  return { from: c.iss };
}
