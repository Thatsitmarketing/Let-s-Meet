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
    ANFRAGE_SCHLUESSEL?: string;
    /** Close Automat (thatsit-close-automat), siehe src/lib/crm.ts */
    CRM_WEBHOOK_URL?: string;
    CRM_WEBHOOK_SECRET?: string;
    /** WhatsApp Bot, siehe docs/whatsapp-bot.md */
    WHATSAPP_TOKEN?: string;
    WHATSAPP_PHONE_NUMBER_ID?: string;
    WHATSAPP_APP_SECRET?: string;
    WHATSAPP_VERIFY_TOKEN?: string;
    WHATSAPP_LEAD_SCHLUESSEL?: string;
    WHATSAPP_API_VERSION?: string;
    WHATSAPP_VORLAGEN_SPRACHE?: string;
    WHATSAPP_TERMINART?: string;
    WHATSAPP_KI_TAGESLIMIT?: string;
    WHATSAPP_TEAM_EMAIL?: string;
    WHATSAPP_KI_MODELL?: string;
    /** Für /app/whatsapp/coexistence (Embedded Signup), nicht geheim */
    WHATSAPP_APP_ID?: string;
    WHATSAPP_EMBEDDED_CONFIG_ID?: string;
    /** WhatsApp Business Konto für /app/whatsapp/vorlagen, nicht geheim */
    WHATSAPP_WABA_ID?: string;
    ANTHROPIC_API_KEY?: string;
    /** Workers AI, für Sprachnachrichten (Whisper) */
    AI?: Ai;
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
