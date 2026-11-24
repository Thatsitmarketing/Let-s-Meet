import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { sitzungStarten } from '../../../lib/auth';
import { wechselEingang } from '../../../lib/wechsel';
import { jtiMerken, kontoSuchen } from '../../../lib/wechsel-db';

/**
 * Tool Wechsel, Eingang: GET /auth/switch/in?token=... Öffentlich, die Prüfung macht das Token
 * (Signatur mit LINK_SECRET, Empfänger meet, 60 Sekunden, einmalig, 2FA Beleg). Danach startet
 * Let's Meet seine eigene Sitzung mit 2FA Flag, ohne Passwort. Antwortet bewusst mit einer Seite
 * und meta refresh statt 302, weil das Strict Cookie sonst nicht mitkäme (siehe wechsel.ts).
 */
export const GET: APIRoute = ({ request, cookies, url }) =>
  wechselEingang(env.LINK_SECRET, request, { kontoSuchen, jtiMerken }, (konto) =>
    sitzungStarten(cookies, konto.id, url.protocol === 'https:', true),
  );
