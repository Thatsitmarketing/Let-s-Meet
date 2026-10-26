// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Let's Meet läuft komplett serverseitig auf Cloudflare Workers.
// Statische Dateien (Schriften, Logos, embed.js) liefert Workers Assets aus.
export default defineConfig({
  site: 'https://termine.thatsit.marketing',
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  security: { checkOrigin: true },
  // Astro Sessions werden nicht genutzt, die Anmeldung läuft über ein eigenes signiertes Cookie
  session: false,
  devToolbar: { enabled: false },
});
