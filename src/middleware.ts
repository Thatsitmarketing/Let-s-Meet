import { defineMiddleware } from 'astro:middleware';
import { nutzerAusSitzung } from './lib/auth';

const OFFEN_IM_APP = ['/app/login', '/app/setup'];

export const onRequest = defineMiddleware(async (ctx, next) => {
  const pfad = ctx.url.pathname;
  const istApp = pfad === '/app' || pfad.startsWith('/app/');
  const istAppApi = pfad.startsWith('/api/app/');

  if (istApp || istAppApi) {
    const nutzer = await nutzerAusSitzung(ctx.cookies);
    if (nutzer) ctx.locals.nutzer = nutzer;
    const offen = OFFEN_IM_APP.some((p) => pfad === p || pfad.startsWith(p + '/'));
    if (!nutzer && !offen) {
      if (istAppApi) {
        return new Response(JSON.stringify({ fehler: 'Nicht angemeldet' }), { status: 401, headers: { 'content-type': 'application/json' } });
      }
      return ctx.redirect(`/app/login?weiter=${encodeURIComponent(pfad + ctx.url.search)}`);
    }
  }

  const antwort = await next();
  const kopf = antwort.headers;
  kopf.set('X-Content-Type-Options', 'nosniff');
  kopf.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  kopf.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (ctx.url.protocol === 'https:') kopf.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  if (istApp || istAppApi) {
    // Backoffice darf nie eingebettet oder zwischengespeichert werden
    kopf.set('X-Frame-Options', 'DENY');
    kopf.set('Content-Security-Policy', "frame-ancestors 'none'");
    kopf.set('Cache-Control', 'no-store');
  } else {
    // Buchungsseiten sind ausdrücklich zum Einbetten auf Kundenwebsites gedacht
    kopf.set('Content-Security-Policy', 'frame-ancestors *');
  }
  return antwort;
});
