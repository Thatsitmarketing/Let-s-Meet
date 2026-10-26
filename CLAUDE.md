# Let's Meet

Eigene Terminbuchung von That's it. Marketing nach dem Vorbild von Calendly: öffentliche Buchungsseiten, einbettbares Widget und ein Backoffice für das Team, komplett im Branding von That's it. Marketing.

## Kunde und Ziel

* Kunde: That's it. Marketing, Gelsenkirchen (intern genutzt, Ansprache per du)
* Ziel: Calendly ersetzen. Interessenten buchen Erstgespräche und Calls direkt, ohne Mailpingpong
* Primäre Conversion: abgeschlossene Buchung auf `/{nutzer}/{terminart}` oder im eingebetteten Widget
* Branding Quelle: „Thats it Marketing Branding Guide“ (Google Drive, Ordner Marketing intern, Version 1.0, 2026)

## Stack und Befehle

| Bereich | Wahl |
| --- | --- |
| Framework | Astro 7, `output: 'server'` |
| Hosting | Cloudflare Workers mit Static Assets (Adapter `@astrojs/cloudflare` 14 unterstützt nur noch Workers, nicht Pages) |
| Datenbank | Cloudflare D1 `terminethatsitmarketing` (ID `26aa6845-79a5-419a-9f2d-8ee308d6f37e`), Binding `DB` |
| Mail | Resend über die HTTP API |
| Spamschutz | Cloudflare Turnstile, Honigtopf, Mindestzeit |
| Kalender | Google Calendar API (OAuth, freeBusy, Termine mit Meet Link) |
| Cron | Cloudflare Cron Trigger alle 10 Minuten (Erinnerungen, Löschfristen) |
| Runtime | Node 24, pnpm 10 (`.nvmrc`, `engines`, `packageManager`) |

```bash
pnpm install
pnpm db:migrate:local      # D1 lokal anlegen
pnpm dev                   # http://localhost:4321, Daemon: astro dev stop | logs
pnpm build                 # baut nach dist/client und dist/server
pnpm astro preview         # gebaute Version lokal in workerd
pnpm check                 # Typprüfung (braucht TypeScript 6, nicht 7)
pnpm db:migrate:remote     # Migrationen auf die echte D1 anwenden
pnpm deploy                # build, Migrationen remote, wrangler deploy
pnpm deploy:cloudflare     # Deploybefehl für Cloudflare Workers Builds (nach pnpm build)
```

Lokale Geheimnisse liegen in `.dev.vars` (nicht eingecheckt). Vorlage mit allen Namen: `.env.example`.

### Deployment als Cloudflare Worker (nicht Pages)

Ein Pages Projekt funktioniert mit diesem Setup nicht (liefert 404), weil der Astro Adapter einen Worker baut.

1. D1 Datenbank ist angelegt und in `wrangler.jsonc` verknüpft (`terminethatsitmarketing`)
2. Cloudflare Dashboard, Workers & Pages, Erstellen, Worker, Repository importieren: `Thatsitmarketing/Let-s-Meet`
3. Workername exakt `let-s-meet` (muss zu `name` in `wrangler.jsonc` passen)
4. Buildbefehl `pnpm build`, Deploybefehl `pnpm run deploy:cloudflare`, Produktionsbranch nach Wahl (aktuell liegt der Code auf `claude/affectionate-pasteur-q3ennq`)
5. Unter Einstellungen, Variablen und Geheimnisse als Secret setzen: `SESSION_SECRET`, `SETUP_TOKEN`, später die übrigen aus `.env.example`
6. Der Deploybefehl wendet die Migrationen auf die D1 an. Falls dem Build Token die D1 Rechte fehlen: einmal lokal `pnpm db:migrate:remote` ausführen
7. Custom Domain `termine.thatsit.marketing` im Worker hinterlegen und `SITE_URL` in `wrangler.jsonc` prüfen
8. `/app/setup` aufrufen, mit `SETUP_TOKEN` das erste Admin Konto anlegen. Danach ist die Seite gesperrt

### Google Kalender einrichten

1. Google Cloud Console: Projekt anlegen, Google Calendar API aktivieren
2. OAuth Zustimmungsbildschirm (intern oder extern), Scopes `calendar.events` und `calendar.freebusy`
3. OAuth Client vom Typ Webanwendung, Weiterleitungs URI `https://termine.thatsit.marketing/api/google/rueckruf` (lokal `http://localhost:4321/api/google/rueckruf`)
4. `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` als Secret setzen
5. Jedes Teammitglied verbindet sich selbst unter Backoffice, Integrationen

### Resend einrichten

Absenderdomain `thatsit.marketing` bei Resend verifizieren (SPF, DKIM), `RESEND_API_KEY` als Secret setzen. Absender und Antwortadresse stehen als `vars` in `wrangler.jsonc`. Ohne Schlüssel werden Mails nur protokolliert.

## Seitenstruktur

Öffentlich (einbettbar, `frame-ancestors *`):

| Pfad | Zweck |
| --- | --- |
| `/` | Teamübersicht, leitet bei nur einer Person direkt auf deren Profil |
| `/{nutzer}` | Profilseite mit allen öffentlichen Terminarten |
| `/{nutzer}/{terminart}` | Buchungsseite: Monatskalender, Zeitzone, Slots, Formular. Parameter: `embed=1`, `details=0`, `name`, `email`, `umbuchen={id}` |
| `/termin/{id}` | Bestätigung und Verwaltung für den Gast (Kalender, Umbuchen, Absagen) |
| `/termin/{id}/absagen` | Absage mit optionalem Grund |
| `/termin/{id}/kalender.ics` | Kalenderdatei |
| `/embed.js` | Widget Skript (Inline, Popup Button, Popup Link) |
| `/api/slots`, `/api/buchen` | Slots abrufen, Buchung anlegen |
| `/api/cron` | Cron manuell auslösen (Bearer `CRON_SECRET`) |
| `/api/google/rueckruf` | OAuth Rückruf (liegt bewusst außerhalb von `/api/app`, siehe Formulare) |

Backoffice (`/app`, geschützt durch Middleware, `noindex`, `X-Frame-Options: DENY`):

| Pfad | Zweck |
| --- | --- |
| `/app/login`, `/app/setup`, `/app/abmelden` | Anmeldung, Ersteinrichtung, Abmelden |
| `/app/terminarten` | Übersicht als Karten, aktiv schalten, Link kopieren, duplizieren, löschen |
| `/app/terminarten/neu`, `/app/terminarten/{id}` | Editor: Titel, Link, Dauer, Farbe, Ort, Planung, Fragen, Mails, Sichtbarkeit |
| `/app/termine` | Anstehend, Vergangen, Abgesagt, Suche, Zeitraum, Team Ansicht für Admins, CSV Export |
| `/app/termine/{id}` | Details, interne Notiz, nicht erschienen, Absagen, Umbuchungslink |
| `/app/verfuegbarkeit` | Wochenzeiten mit mehreren Zeiträumen pro Tag, Zeitzone, Ausnahmen für Tage oder Zeiträume |
| `/app/einbetten` | Codegenerator mit Live Vorschau |
| `/app/integrationen` | Google Kalender, Webhook mit HMAC Signatur |
| `/app/einstellungen` | Profil, Buchungslink, Passwort |
| `/app/team` | Nur Admins: Mitglieder anlegen, Rolle, deaktivieren, Passwort setzen |

## Designsystem: Tokens, Schriften, Typoskala

Alle Werte in `src/styles/tokens.css`, abgeleitet aus dem Branding Guide.

* Farben: Schwarz `#0E0E0E`, Orange `#DC9832`, Weiß. Neutraltöne `--n-050` bis `--n-900`. Semantik Erfolg `#2F8F5F`, Fehler `#C4382C`, Info `#2B6CB0`
* Orange ist Akzent (etwa 5 Prozent): orangener Punkt hinter Überschriften, primärer Button, aktive Navigation. Keine Tints oder Shades, Hover über Opacity 0.88
* Schriften, selbst gehostet in `public/fonts/`: League Spartan (variabel, Überschriften 900), Montserrat (variabel, Fließtext), Barlow Condensed 300 und 500 (gesperrte Labels und Buttons)
* Typoskala: Display bis 64px, H1 32 bis 48px, H2 26 bis 36px, H3 22px, H4 18px, Body 16px, Labels 14px mit 0.4em Sperrung
* Form: eckig, Radius 2px für UI, 0px für Markenflächen, Pillen nur für Status
* Icons: Lucide, Strichstärke 1.75, in `src/components/ui/Icon.astro`
* Logos: `public/images/brand/logo-schwarz.*` und `logo-weiss.*` (aus dem Branding Guide extrahiert)

## Komponenten und wo sie liegen

| Datei | Inhalt |
| --- | --- |
| `src/styles/global.css` | Basis, Knöpfe (`.knopf`, `--orange`, `--rahmen`, `--leise`, `--gefahr`, `--klein`), Felder, Schalter, Badges, Pillen, Hinweise, Karten |
| `src/layouts/Basis.astro` | HTML Grundgerüst, Meta, Preload der Schriften |
| `src/layouts/Oeffentlich.astro` | Kopf und Fuß der öffentlichen Seiten, Embed Modus mit Höhenmeldung an das Widget |
| `src/layouts/App.astro` | Backoffice mit schwarzer Seitenleiste, mobilem Menü, Kopierknöpfen, Rückfragen |
| `src/layouts/Zugang.astro` | Login und Einrichtung |
| `src/components/TerminartFormular.astro` | Editor der Terminarten inklusive Fragenliste |
| `src/components/Avatar.astro`, `OrtIcon.astro`, `ui/Logo.astro`, `ui/Icon.astro` | Kleinteile |
| `src/scripts/buchung.ts` | Kalender, Zeitzonen, Slotwahl und Formularversand im Browser |
| `public/embed.js` | Widget ohne Abhängigkeiten, API `LetsMeet.initInlineWidget`, `initBadgeWidget`, `showPopupWidget`, `closePopupWidget`, Ereignis `letsmeet:gebucht` |

Logik in `src/lib/`: `slots.ts` (freie Zeiten), `zeit.ts` (Zeitzonen ohne Bibliothek), `buchungen.ts` (anlegen, absagen, umbuchen, Mails, Webhook, Cron), `google.ts`, `mail.ts` (Vorlagen), `ics.ts`, `auth.ts`, `konten.ts`, `terminart-formular.ts`, `termin-filter.ts`.

## Formulare und Datenfluss

Buchung (`POST /api/buchen`, JSON):
1. Honigtopf `website` und Mindestzeit 2,5 Sekunden, Bots bekommen Erfolg ohne Wirkung
2. Turnstile Prüfung (nur wenn `TURNSTILE_SECRET_KEY` gesetzt)
3. Serverseitige Validierung, Fehler feldbezogen (422)
4. Slot wird erneut gegen Regeln, Buchungen und Google geprüft (409 wenn weg)
5. Speichern in D1, danach Doppelbuchungsschutz über die rowid Reihenfolge
6. Google Termin mit Meet Link, danach im Hintergrund Mails an Gast und Gastgeber mit ICS Anhang und Webhook

Slotberechnung: Wochenregeln oder Tagesausnahme in der Zone des Gastgebers, Raster, Dauer, Puffer davor und danach, Mindestvorlauf, Buchbarkeit in Tagen, Tageslimit pro Terminart, alle bestätigten Buchungen des Gastgebers, Google freeBusy.

Umbuchen: Gast öffnet die Buchungsseite mit `?umbuchen={id}`. Die alte Buchung zählt nicht als belegt, wird nach der neuen Buchung storniert (`storno_grund = Umgebucht`, Verweis `umgebucht_zu`).

Anmeldung Backoffice: Passwort als PBKDF2 SHA256 (100.000 Iterationen), Sitzung als HMAC signiertes Cookie `lm_sitzung` (HttpOnly, SameSite Strict, 8 Stunden), Sperre 15 Minuten nach 5 Fehlversuchen, CSRF Schutz über Astro `checkOrigin`. Der Google Rückruf liegt außerhalb von `/api/app`, weil das Strict Cookie bei der Rückleitung von Google nicht mitkommt. Die Zuordnung läuft über einen signierten state mit eigenem Zweck, er ist nie als Sitzung gültig.

Webhook Ereignisse: `buchung.erstellt`, `buchung.umgebucht`, `buchung.storniert`, `test`. Header `x-letsmeet-signatur` = HMAC SHA256 des Rohkörpers mit dem Signaturschlüssel.

Datenbank: `migrations/0001_grundschema.sql` mit den Tabellen `nutzer`, `terminarten`, `verfuegbarkeit`, `ausnahmen`, `buchungen`. Keine IP Adressen, keine User Agents. Löschfrist `loeschen_ab` 365 Tage nach Terminende, der Cron löscht.

## Umgebungsvariablen mit Zweck, ohne Werte

| Name | Art | Zweck |
| --- | --- | --- |
| `SESSION_SECRET` | Secret | Signatur von Sitzung und OAuth state, mindestens 32 Zeichen |
| `SETUP_TOKEN` | Secret | Einmalige Ersteinrichtung unter `/app/setup` |
| `CRON_SECRET` | Secret | Schutz von `/api/cron` |
| `RESEND_API_KEY` | Secret | Versand aller Mails |
| `PUBLIC_TURNSTILE_SITE_KEY` | Secret oder var | Turnstile Widget im Buchungsformular |
| `TURNSTILE_SECRET_KEY` | Secret | Serverseitige Turnstile Prüfung |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Secret | Google Kalender Verbindung |
| `SITE_URL` | var | Öffentliche Adresse für Mails aus dem Cron |
| `MAIL_FROM`, `MAIL_REPLY_TO` | var | Absender und Antwortadresse |

## Consent und eingesetzte Dienste

* Gäste bekommen keine Cookies, kein Tracking, keine Analytics. Darum kein Consent Banner nötig
* Backoffice Cookie `lm_sitzung` ist technisch notwendig
* Dienste mit Datenverarbeitung, die in die Datenschutzerklärung von thatsit.marketing gehören: Cloudflare (Hosting, D1, Turnstile), Resend (Mailversand), Google (Kalender und Meet, nur wenn verbunden)
* Das Widget feuert auf der einbindenden Seite `letsmeet:gebucht` und schiebt `letsmeet_gebucht` in einen vorhandenen `dataLayer`. Tracking darüber läuft nur, wenn die einbindende Seite das nach Einwilligung erlaubt

## Offene Punkte

* Worker `let-s-meet` läuft unter `let-s-meet.aged-brook-9137.workers.dev`. Pages Projekt `let-s-meet` kann gelöscht werden
* Secrets in Cloudflare setzen, Resend Domain verifizieren, Turnstile Widget anlegen
* Google OAuth Client anlegen (Anleitung oben). Google Verbindung, freeBusy und Meet Links sind mangels Zugang in der Entwicklung nicht live getestet
* Domain: Vorschlag `termine.thatsit.marketing`, in `astro.config.mjs` (`site`) und `wrangler.jsonc` (`SITE_URL`) hinterlegt, noch zu bestätigen
* Datenschutzerklärung auf thatsit.marketing um Let's Meet ergänzen (Zweck, Rechtsgrundlage, Speicherdauer 12 Monate, Empfänger Cloudflare, Resend, Google)
* Profilbilder des Teams als https Link unter Einstellungen hinterlegen
* Optional später: Rundenverteilung im Team, mehrere Verfügbarkeitspläne pro Person, Zahlungen, Microsoft Kalender

## Änderungsverlauf mit Datum

* 2026-10-26: Erstversion. Buchungsseiten, Widget, Backoffice (Terminarten, Termine, Verfügbarkeit, Einbetten, Integrationen, Einstellungen, Team), Google Kalender, Resend Mails mit ICS, Webhooks, Cron für Erinnerungen und Löschfristen. Build, Typprüfung, Klickstrecke und Responsive Check in fünf Breiten lokal geprüft
* 2026-10-26: D1 Datenbank `terminethatsitmarketing` verknüpft, Workername `let-s-meet`, Deploybefehl inklusive Migrationen, Anleitung für Workers Builds
* 2026-10-26: Schema `0001_grundschema.sql` auf die D1 `terminethatsitmarketing` eingespielt und in `d1_migrations` vermerkt, damit `wrangler d1 migrations apply` es nicht doppelt ausführt
