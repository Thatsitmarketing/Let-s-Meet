/**
 * Eigener Worker Einstieg: Astro beantwortet alle Anfragen,
 * zusätzlich läuft der Cron für Erinnerungen, Löschfristen und den Google Abgleich.
 */
import { handle } from '@astrojs/cloudflare/handler';
import { cronLauf } from './lib/buchungen';

export default {
  fetch: handle,
  async scheduled(_ereignis, _env, ctx) {
    ctx.waitUntil(
      cronLauf()
        .then((r) => console.log('Cron', r))
        .catch((f) => console.error('Cron fehlgeschlagen', f)),
    );
  },
} satisfies ExportedHandler;
