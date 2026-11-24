import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { sitzungAusCookies } from '../../lib/auth';
import { wechselAusgang } from '../../lib/wechsel';

/**
 * Tool Wechsel, Ausgang: GET /auth/switch?to=<id>. Nur mit gültiger Backoffice Sitzung.
 * Das Backoffice hat keine 2FA, das Token gibt es deshalb nur, wenn die Sitzung selbst über
 * /auth/switch/in aus einem Tool mit 2FA entstanden ist. Ohne LINK_SECRET antwortet die Route mit 404.
 */
export const GET: APIRoute = async ({ request, cookies }) => {
  const sitzung = await sitzungAusCookies(cookies).catch(() => null);
  return wechselAusgang(env.LINK_SECRET, request, sitzung);
};
