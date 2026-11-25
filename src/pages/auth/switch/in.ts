import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { sitzungStarten } from '../../../lib/auth';
import { wechselEingang, zweiFaktorPflicht } from '../../../lib/wechsel';
import { jtiMerken, kontoSuchen } from '../../../lib/wechsel-db';

/**
 * Tool Wechsel, Eingang: GET /auth/switch/in?token=... Öffentlich, die Prüfung macht das Token
 * (Signatur mit LINK_SECRET, Empfänger meet, 60 Sekunden, einmalig, 2FA Beleg nur mit LINK_REQUIRE_2FA=1). Danach startet
 * Let's Meet seine eigene Sitzung ohne Passwort, das 2FA Flag trägt sie nur, wenn das Token einen Beleg hatte. Antwortet bewusst mit einer Seite
 * und meta refresh statt 302, weil das Strict Cookie sonst nicht mitkäme (siehe wechsel.ts).
 */
export const GET: APIRoute = ({ request, cookies, url }) =>
  wechselEingang(env.LINK_SECRET, request, { kontoSuchen, jtiMerken }, (konto, twofa) =>
    sitzungStarten(cookies, konto.id, url.protocol === 'https:', twofa),
    zweiFaktorPflicht(env.LINK_REQUIRE_2FA),
  );
