/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare/types.d.ts" />

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    SITE_URL?: string;
    MAIL_FROM?: string;
    MAIL_REPLY_TO?: string;
    SESSION_SECRET?: string;
    SETUP_TOKEN?: string;
    CRON_SECRET?: string;
    RESEND_API_KEY?: string;
    PUBLIC_TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
    /** Gemeinsamer Schlüssel der vier Playbook Landingpages für /api/playbook/anfordern */
    PLAYBOOK_SCHLUESSEL?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
  }
}

declare namespace App {
  interface Locals {
    nutzer?: import('./lib/typen').Nutzer;
    /** Zentrales Büro Konto, dem Terminarten, Verfügbarkeit, Google und Buchungen gehören */
    gastgeber?: import('./lib/typen').Nutzer;
  }
}
