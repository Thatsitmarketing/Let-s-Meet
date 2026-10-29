/**
 * Eigener Worker Einstieg: Astro beantwortet alle Anfragen,
 * zusätzlich läuft der Cron für Erinnerungen, Löschfristen und den Google Abgleich.
 */
import { handle } from '@astrojs/cloudflare/handler';
import { cronLauf } from './lib/buchungen';

/**
 * Die Playbook Dateien liegen als Assets in /playbook-dateien/, sind aber nie direkt abrufbar.
 * wrangler.jsonc schickt diese Pfade zuerst an den Worker (run_worker_first), hier enden sie mit 404.
 * Ausgeliefert werden sie nur über /playbook/{id}/... nach Prüfung des persönlichen Links.
 */
const GESCHUETZT = '/playbook-dateien/';

export default {
  fetch(anfrage, env, ctx) {
    if (new URL(anfrage.url).pathname.toLowerCase().startsWith(GESCHUETZT)) {
      return new Response('Nicht gefunden', { status: 404, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
    }
    return handle(anfrage, env, ctx);
  },
  async scheduled(_ereignis, _env, ctx) {
    ctx.waitUntil(
      cronLauf()
        .then((r) => console.log('Cron', r))
        .catch((f) => console.error('Cron fehlgeschlagen', f)),
    );
  },
} satisfies ExportedHandler;
