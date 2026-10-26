import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { cronLauf } from '../../lib/buchungen';
import { json } from '../../lib/eingabe';

/** Manueller oder externer Auslöser für den Cron, falls keine Cron Trigger genutzt werden. */
export const POST: APIRoute = async ({ request }) => {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!env.CRON_SECRET || token !== env.CRON_SECRET) return json(401, { fehler: 'Nicht erlaubt' });
  return json(200, await cronLauf());
};
