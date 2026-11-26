# Let's Meet

**Diese Datei ist bewusst kurz.** Claude Code liest sie bei jedem Schritt mit. Einzelheiten stehen unter `docs/`, siehe „Wo was steht“.

Eigene Terminbuchung von That's it. Marketing nach dem Vorbild von Calendly: eine zentrale Buchungsseite für das Büro, einbettbares Widget und ein Backoffice für das Team, komplett im Branding von That's it. Marketing.

**Zentrale Buchung (seit 2026-10-27):** Gebucht wird nie bei einzelnen Mitarbeitern, sondern immer beim Büro `info@thatsit.marketing`. Das Büro ist ein Eintrag in `nutzer` mit `ist_buero = 1`. Ihm gehören Terminarten, Verfügbarkeit, Ausnahmen, Google Kalender, Webhook und alle Buchungen. Teammitglieder melden sich mit ihrem eigenen Konto an und verwalten das Büro gemeinsam (Middleware setzt `locals.gastgeber` = Büro, `locals.nutzer` = angemeldete Person).

## Kunde und Ziel

* Kunde: That's it. Marketing, Gelsenkirchen (intern genutzt, Ansprache per du)
* Ziel: Calendly ersetzen. Interessenten buchen Erstgespräche und Calls direkt, ohne Mailpingpong
* Primäre Conversion: abgeschlossene Buchung auf `/` bzw. `/{terminart}` oder im eingebetteten Widget
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
| QR-Codes | `uqr` (Kodierung), SVG und PNG baut `src/lib/qr.ts` selbst im Worker |
| Cron | Cloudflare Cron Trigger alle 10 Minuten (Arbeitsabläufe wie Erinnerungen, Löschfristen, Abgleich Google Kalender) |
| Runtime | Node 24, pnpm 10 (`.nvmrc`, `engines`, `packageManager`) |

```bash
pnpm install
pnpm db:migrate:local      # D1 lokal anlegen
pnpm dev                   # http://localhost:4321, Daemon: astro dev stop | logs
pnpm build                 # baut nach dist/client und dist/server
pnpm astro preview         # gebaute Version lokal in workerd
pnpm check                 # Typprüfung (braucht TypeScript 6, nicht 7)
pnpm test                  # Tests mit node --test (tests/*.test.ts, ohne Abhängigkeiten)
pnpm db:migrate:remote     # Migrationen auf die echte D1 anwenden
pnpm deploy                # build, Migrationen remote, wrangler deploy
pnpm deploy:cloudflare     # Deploybefehl für Cloudflare Workers Builds (nach pnpm build)
```

**Arbeitsregel Migrationen:** Workers Builds spielt Migrationen nicht zuverlässig ein (bei 0014 am 2026-11-16 nachgewiesen: Code deployt, Migration fehlte). Neue Migrationen immer direkt selbst auf der D1 `terminethatsitmarketing` ausführen (Cloudflare MCP `d1_database_query`, Anweisung für Anweisung) und danach in `d1_migrations` vermerken (`INSERT INTO d1_migrations (name, applied_at) VALUES ('000X_name.sql', CURRENT_TIMESTAMP)`), damit der Deploybefehl sie nicht doppelt ausführt. Nicht auf den Merge oder den Deploy warten. Ausnahme: braucht eine Datenänderung neuen Code (etwa neue Syntax in Mailtexten), erst nach dem Deploy einspielen und vorher im Workercode prüfen, dass der neue Stand live ist. Vorher mit `SELECT name FROM d1_migrations` prüfen, was schon eingespielt ist.

Lokale Geheimnisse liegen in `.dev.vars` (nicht eingecheckt). Vorlage mit allen Namen: `.env.example`.

### Deployment als Cloudflare Worker (nicht Pages)

Ein Pages Projekt funktioniert mit diesem Setup nicht (liefert 404), weil der Astro Adapter einen Worker baut.

1. D1 Datenbank ist angelegt und in `wrangler.jsonc` verknüpft (`terminethatsitmarketing`)
2. Cloudflare Dashboard, Workers & Pages, Erstellen, Worker, Repository importieren: `Thatsitmarketing/Let-s-Meet`
3. Workername exakt `let-s-meet` (muss zu `name` in `wrangler.jsonc` passen)
4. Buildbefehl `pnpm build`, Deploybefehl `pnpm run deploy:cloudflare`, Produktionsbranch `main` (empfohlen, der alte Branch `claude/affectionate-pasteur-q3ennq` ist veraltet)
5. Unter Einstellungen, Variablen und Geheimnisse als Secret setzen: `SESSION_SECRET`, `SETUP_TOKEN`, später die übrigen aus `.env.example`
6. Der Deploybefehl wendet die Migrationen auf die D1 an. Falls dem Build Token die D1 Rechte fehlen: einmal lokal `pnpm db:migrate:remote` ausführen
7. Custom Domain `letsmeet.thatsit.marketing` im Worker hinterlegen und `SITE_URL` in `wrangler.jsonc` prüfen
8. `/app/setup` aufrufen, mit `SETUP_TOKEN` das erste Admin Konto anlegen. Danach ist die Seite gesperrt

### Google Kalender einrichten

1. Google Cloud Console: Projekt anlegen, Google Calendar API aktivieren
2. OAuth Zustimmungsbildschirm (intern oder extern), Scopes `calendar.events` und `calendar.freebusy`
3. OAuth Client vom Typ Webanwendung, Weiterleitungs URI `https://letsmeet.thatsit.marketing/api/google/rueckruf` (lokal `http://localhost:4321/api/google/rueckruf`). Die URI wird aus der Adresse im Browser gebildet (`url.origin`), daher jede genutzte Domain eintragen, auch `https://let-s-meet.<konto>.workers.dev/api/google/rueckruf`, solange die Custom Domain noch nicht läuft. Sonst meldet Google `redirect_uri_mismatch`
4. `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` als Secret setzen
5. Unter Backoffice, Integrationen einmal „Mit Google verbinden“ und bei Google mit **info@thatsit.marketing** anmelden. Die Verbindung gehört dem Büro, alle Buchungen landen in diesem Kalender

### Resend einrichten

Absenderdomain `thatsit.marketing` bei Resend verifizieren (SPF, DKIM), `RESEND_API_KEY` als Secret setzen. Absender und Antwortadresse stehen als `vars` in `wrangler.jsonc`. Ohne Schlüssel werden Mails nur protokolliert.

## Designsystem: Tokens, Schriften, Typoskala

Alle Werte in `src/styles/tokens.css`, abgeleitet aus dem Branding Guide.

* Farben: Schwarz `#0E0E0E`, Orange `#DC9832`, Weiß. Neutraltöne `--n-050` bis `--n-900`. Semantik Erfolg `#2F8F5F`, Fehler `#C4382C`, Info `#2B6CB0`
* Orange ist Akzent (etwa 5 Prozent): orangener Punkt hinter Überschriften, primärer Button, aktive Navigation. Keine Tints oder Shades, Hover über Opacity 0.88
* Schriften, selbst gehostet in `public/fonts/`: League Spartan (variabel, Überschriften 900), Montserrat (variabel, Fließtext), Barlow Condensed 300 und 500 (gesperrte Labels und Buttons)
* Typoskala: Display bis 64px, H1 32 bis 48px, H2 26 bis 36px, H3 22px, H4 18px, Body 16px, Labels 14px mit 0.4em Sperrung
* Form: eckig, Radius 2px für UI, 0px für Markenflächen, Pillen nur für Status
* Icons: Lucide, Strichstärke 1.75, in `src/components/ui/Icon.astro`
* Backoffice Breite: Inhalt bis 1840px, Formularseiten (Einstellungen, Integrationen) ab 560px pro Karte nebeneinander. Verfügbarkeit: ab 1800px Wochenzeiten links und Kalender rechts, ab 1380px Kalender oben und Wochenzeiten neben Ausnahmen, darunter einspaltig
* Logo Let's Meet: überall kompakt ohne Unterzeile (Seitenleiste, Login). Nicht in Mails: seit 2026-10-29 steht im Kopf aller Mails das schwarze Logo That's it. Marketing (`public/images/brand/mail-kopf-hell.png`, 1200 × 176, Logo auf festem weißem Grund im Bild, darunter eine schwarze Linie, Link auf thatsit.marketing). Der weiße Grund steckt im Bild, damit das Logo auch im Dark Mode von Gmail sichtbar bleibt (Gmail färbt dort Hintergründe um, Bilder nicht; das weiße Let's Meet Logo auf Schwarz war deshalb unsichtbar). Dateien: `public/images/brand/letsmeet-schwarz.svg` und `letsmeet-weiss.svg` (mit Unterzeile „THAT'S IT. MARKETING“), `letsmeet-kompakt-*.svg` (nur „Let's Meet.“), PNG 600px für Mails (`letsmeet-weiss.png`, `letsmeet-schwarz.png`). Aufbau wie das That's it. Logo: t, Apostroph, s und orangener Quadratpunkt aus dem Original vektorisiert, L und M aus den gemessenen Strichstärken gebaut (Versalhöhe 129, Grundstrich 21,3, Querstrich 17), e aus Inter angeglichen, Unterzeile Montserrat 240 mit 0,4em Sperrung, rechtsbündig zum letzten t. Alle Schriften als Pfade, keine Webfonts nötig. Mindestgröße der vollen Variante etwa 150px Breite, darunter kompakt nutzen
* Favicon: identisch zur Homepage, weißes „That's it.“ mit orangenem Punkt auf transparentem Grund (`public/favicon.png` 512px, Quelle `thatsit_homepage_new/public/favicon.png`), daraus `favicon.ico` (16, 32, 48), `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` auf Schwarz, `site.webmanifest`. Das alte L Favicon (`favicon.svg`) ist entfernt. Hinweis: wie auf der Homepage ist das transparente Favicon in hellen Browsertabs kaum sichtbar. Diese Pfade stehen in `RESERVIERTE_SLUGS`
* Bilder: jedes `<img>` hat Alt Text und `title` (Logos, Avatare im Backoffice, Mailkopf)
* Logos That's it. Marketing (Original): `public/images/brand/logo-schwarz.*` und `logo-weiss.*` (aus dem Branding Guide extrahiert). `logo-schwarz.webp` ist seit 2026-10-28 nicht mehr in der Terminkachel eingebunden, oben auf dem Bürofoto steht `logo-weiss.webp`
* Bilder aus dem Repository der neuen Homepage (`Thatsitmarketing/thatsit_homepage_new`, `src/assets/bilder`): Besprechungsraum mit Logowand `buero-tisch.jpg` als `public/images/buero/besprechungsraum-1200.webp` und `-2400.webp` (Seitenhintergrund, abgedunkelt, ab 1000px die große Datei, auf Desktop fixiert), `start/team-held.jpg` als `public/images/team/team-besprechung.webp` (derzeit nicht eingebunden), Playbook Mockups als `public/images/unterlagen/*.webp` (nur noch als Vorschaubild im Terminart Editor hinterlegt, auf der Buchungsseite nicht sichtbar). Die Teamportraits sind seit 2026-10-27 entfernt

## Umgebungsvariablen mit Zweck, ohne Werte

| Name | Art | Zweck |
| --- | --- | --- |
| `SESSION_SECRET` | Secret | Signatur von Sitzung und OAuth state, mindestens 32 Zeichen |
| `SETUP_TOKEN` | Secret | Einmalige Ersteinrichtung unter `/app/setup` |
| `CRON_SECRET` | Secret | Schutz von `/api/cron` |
| `LINK_SECRET` | Secret | Tool Wechsel (`/auth/switch`): Signatur der Wechsel Token, gleicher Wert in allen That's it. Tools, mindestens 32 Zeichen. Ohne ihn antworten beide Routen mit 404 |
| `RESEND_API_KEY` | Secret | Versand aller Mails |
| `PUBLIC_TURNSTILE_SITE_KEY` | Secret oder var | Turnstile Widget im Buchungsformular |
| `TURNSTILE_SECRET_KEY` | Secret | Serverseitige Turnstile Prüfung |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Secret | Google Kalender Verbindung |
| `SITE_URL` | var | Öffentliche Adresse für Mails aus dem Cron |
| `MAIL_FROM`, `MAIL_REPLY_TO` | var | Absender und Antwortadresse |
| `ANFRAGE_SCHLUESSEL` | Secret | Gemeinsamer Schlüssel mit dem Website Entwurf Funnel (Pages Projekt `ads-web-entwurf`, gleicher Name) für `/api/anfrage`, mindestens 24 Zeichen. Ohne ihn ist die Schnittstelle zu |
| `PLAYBOOK_SCHLUESSEL` | Secret | Gemeinsamer Schlüssel mit den vier Playbook Landingpages für `/api/playbook/anfordern`, mindestens 24 Zeichen. Ohne ihn ist die Schnittstelle zu |
| `CRM_WEBHOOK_URL` | Secret | Adresse des Close Automaten, `https://thatsit-close-automat.aged-brook-9137.workers.dev/letsmeet/webhook` |
| `CRM_WEBHOOK_SECRET` | Secret | Signaturschlüssel, zeichengleich mit `LETSMEET_WEBHOOK_SECRET` im Worker `thatsit-close-automat` |

| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Secret | WhatsApp Cloud API, Token des Systemnutzers und ID der Firmennummer |
| `WHATSAPP_APP_SECRET` | Secret | Prüft die Signatur des Webhooks von Meta |
| `WHATSAPP_VERIFY_TOKEN` | Secret | Frei gewählt, beim Eintragen des Webhooks bei Meta |
| `WHATSAPP_LEAD_SCHLUESSEL` | Secret | Gemeinsam mit der Landingpage (dort `BOT_SCHLUESSEL`), mindestens 24 Zeichen |
| `ANTHROPIC_API_KEY` | Secret | Claude im WhatsApp Bot |
| `WHATSAPP_TERMINART`, `WHATSAPP_TEAM_EMAIL` | var | Terminart der Buchung, Postfach für „bitte anrufen“ |
| `WHATSAPP_WABA_ID` | var | WhatsApp Business Konto für `/app/whatsapp/vorlagen`, derzeit das Testkonto `28262667900101120`, nach dem Verbinden der Firmennummer auf deren Konto umstellen |
| `WHATSAPP_APP_ID`, `WHATSAPP_EMBEDDED_CONFIG_ID` | var | Meta App ID und Facebook Login Konfiguration für `/app/whatsapp/coexistence` (Embedded Signup), nicht geheim |

## Consent und eingesetzte Dienste

* Gäste bekommen keine Cookies, kein Tracking, keine Analytics. Darum kein Consent Banner nötig
* Playbook Seite: kein Cookie, gezählt werden nur Öffnen und Download am persönlichen Link (Zeitpunkt und Anzahl, keine IP, kein Gerät). Gehört als Zweck „Bereitstellung des Playbooks und Nachverfolgung der Anfrage“ in die Datenschutzerklärung der Landingpages
* Backoffice Cookie `lm_sitzung` ist technisch notwendig
* Dienste mit Datenverarbeitung, die in die Datenschutzerklärung von thatsit.marketing gehören: Cloudflare (Hosting, D1, Turnstile, Workers AI für Sprachnachrichten), Resend (Mailversand), Google (Kalender und Meet, nur wenn verbunden), Meta (WhatsApp Cloud API) und Anthropic (Claude) für den WhatsApp Bot. Die Datenschutzerklärung der Landingpage Website-Entwurf nennt beide seit 2026-11-14
* Geprüft 2026-10-30 (Kundenwunsch Skriptblockierung auf allen Seiten): öffentliche Seiten laden nichts von fremden Servern, setzen kein Cookie und schreiben nichts in den Speicher des Browsers (Startseite, Terminarten, Login, Playbook Seite im Browser durchgesehen). Turnstile lädt erst beim Buchen (notwendig). **Wer hier Tracking, Karten, Videos oder Schriften von fremden Servern einbaut, braucht vorher einen Consent Banner** (Vorlage: `ConsentBanner.astro` und `consent.ts` aus `thatsit_homepage_new`)
* Das Widget feuert auf der einbindenden Seite `letsmeet:gebucht` und schiebt `letsmeet_gebucht` in einen vorhandenen `dataLayer`. Tracking darüber läuft nur, wenn die einbindende Seite das nach Einwilligung erlaubt

## Wo was steht

| Datei | Inhalt |
|---|---|
| [docs/seitenstruktur.md](docs/seitenstruktur.md) | Seitenstruktur |
| [docs/komponenten.md](docs/komponenten.md) | Komponenten und wo sie liegen |
| [docs/formulare-und-datenfluss.md](docs/formulare-und-datenfluss.md) | Formulare und Datenfluss |
| [docs/projektstand.md](docs/projektstand.md) | Offene Punkte |
| [docs/aenderungsverlauf.md](docs/aenderungsverlauf.md) | Änderungsverlauf mit Datum |

## Dokumentation pflegen

* Neue Einträge im Änderungsverlauf kommen oben in `docs/aenderungsverlauf.md`, neue Punkte zum Projektstand unten in `docs/projektstand.md`.
* Längere Funktions und Referenzbeschreibungen gehören nach `docs/<thema>.md` und bekommen hier in „Wo was steht“ eine Zeile.
* Diese Datei bleibt unter rund 40 KB und enthält nur Ziel, Stack, Befehle, feste Regeln und Verweise.
