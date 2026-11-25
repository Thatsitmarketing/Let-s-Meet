import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { sitzungAusCookies } from '../../lib/auth';
import { wechselAusgang, zweiFaktorPflicht } from '../../lib/wechsel';

/**
 * Tool Wechsel, Ausgang: GET /auth/switch?to=<id>. Nur mit gültiger Backoffice Sitzung.
 * Standard: jede angemeldete Sitzung darf wechseln. Mit LINK_REQUIRE_2FA=1
 * gibt es das Token nur, wenn die Sitzung über /auth/switch/in aus einem Tool mit 2FA entstand. Ohne LINK_SECRET antwortet die Route mit 404.
 */
export const GET: APIRoute = async ({ request, cookies }) => {
  const sitzung = await sitzungAusCookies(cookies).catch(() => null);
  return wechselAusgang(env.LINK_SECRET, request, sitzung, zweiFaktorPflicht(env.LINK_REQUIRE_2FA));
};
