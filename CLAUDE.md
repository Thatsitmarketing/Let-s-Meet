# Let's Meet

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

## Seitenstruktur

Öffentlich (einbettbar, `frame-ancestors *`):

| Pfad | Zweck |
| --- | --- |
| `/` | Zentrale Buchungsseite: erste öffentliche Terminart des Büros, Kalender mit direkt geöffnetem erstem freien Tag, rechts „Dein Termin“ mit Logo That's it., Dauer, Ort und Beschreibung. Bürofoto als Hintergrund. Ziel: alles in einem Blickfeld (Karte endet bei 1440 × 820 knapp am Rand, bei 1920 × 960 komplett sichtbar). Bei mehreren Terminarten Auswahl oben |
| `/{terminart}` | Dieselbe Seite für eine bestimmte Terminart. Parameter: `embed=1`, `details=0`, `name`, `email`, `umbuchen={id}`. Vorbelegung ohne Serverkontakt über das Fragment `#name=&email=&telefon=&nachricht=&quelle=` (Schnittstelle zur Homepage, siehe unten) |
| `/{nutzer}`, `/{nutzer}/{terminart}` | Alte Personenlinks, 301 auf `/` bzw. `/{terminart}` (Parameter bleiben erhalten) |
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
| `/app/terminarten/neu`, `/app/terminarten/{id}` | Editor: Titel, Link, Dauer, Farbe, Ort, Unterlagen zur Vorbereitung, Planung, Fragen, Mails, Sichtbarkeit |
| `/app/termine` | Standard Tab Kalender (Woche oder Monat, daneben „Als Nächstes“), dazu Listen Anstehend, Vergangen, Abgesagt mit Suche und Zeitraum, Team Ansicht für Admins, CSV Export. Parameter: `ansicht`, `kal=woche\|monat`, `datum`, `wer=team` |
| `/app/termine/{id}` | Details, interne Notiz, nicht erschienen, Absagen, Umbuchungslink |
| `/app/verfuegbarkeit` | Wochenzeiten mit mehreren Zeiträumen pro Tag, Zeitzone, Kalender mit Live Vorschau ungespeicherter Wochenzeiten, Ausnahmen für Tage oder Zeiträume (Klick auf einen Tag im Kalender trägt das Datum ein, `?ausnahme=`) |
| `/app/einbetten` | Codegenerator mit Live Vorschau |
| `/app/integrationen` | Google Kalender, Webhook mit HMAC Signatur |
| `/app/einstellungen` | Admins: zentrale Buchungsseite (Name des Büros als Gastgeber, Text unter „Lass uns reden.“). Alle: eigenes Profil und Passwort |
| `/app/team` | Nur Admins: Mitglieder anlegen, Rolle, deaktivieren, Passwort setzen. Das Büro steht oben mit Badge „Büro, zentrale Buchung“ und lässt sich nicht deaktivieren |

## Designsystem: Tokens, Schriften, Typoskala

Alle Werte in `src/styles/tokens.css`, abgeleitet aus dem Branding Guide.

* Farben: Schwarz `#0E0E0E`, Orange `#DC9832`, Weiß. Neutraltöne `--n-050` bis `--n-900`. Semantik Erfolg `#2F8F5F`, Fehler `#C4382C`, Info `#2B6CB0`
* Orange ist Akzent (etwa 5 Prozent): orangener Punkt hinter Überschriften, primärer Button, aktive Navigation. Keine Tints oder Shades, Hover über Opacity 0.88
* Schriften, selbst gehostet in `public/fonts/`: League Spartan (variabel, Überschriften 900), Montserrat (variabel, Fließtext), Barlow Condensed 300 und 500 (gesperrte Labels und Buttons)
* Typoskala: Display bis 64px, H1 32 bis 48px, H2 26 bis 36px, H3 22px, H4 18px, Body 16px, Labels 14px mit 0.4em Sperrung
* Form: eckig, Radius 2px für UI, 0px für Markenflächen, Pillen nur für Status
* Icons: Lucide, Strichstärke 1.75, in `src/components/ui/Icon.astro`
* Backoffice Breite: Inhalt bis 1840px, Formularseiten (Einstellungen, Integrationen) ab 560px pro Karte nebeneinander. Verfügbarkeit: ab 1800px Wochenzeiten links und Kalender rechts, ab 1380px Kalender oben und Wochenzeiten neben Ausnahmen, darunter einspaltig
* Logo Let's Meet: überall kompakt ohne Unterzeile (Seitenleiste, Seitenleiste, Login, Mailkopf mit `letsmeet-kompakt-weiss.png`). Dateien: `public/images/brand/letsmeet-schwarz.svg` und `letsmeet-weiss.svg` (mit Unterzeile „THAT'S IT. MARKETING“), `letsmeet-kompakt-*.svg` (nur „Let's Meet.“), PNG 600px für Mails (`letsmeet-weiss.png`, `letsmeet-schwarz.png`). Aufbau wie das That's it. Logo: t, Apostroph, s und orangener Quadratpunkt aus dem Original vektorisiert, L und M aus den gemessenen Strichstärken gebaut (Versalhöhe 129, Grundstrich 21,3, Querstrich 17), e aus Inter angeglichen, Unterzeile Montserrat 240 mit 0,4em Sperrung, rechtsbündig zum letzten t. Alle Schriften als Pfade, keine Webfonts nötig. Mindestgröße der vollen Variante etwa 150px Breite, darunter kompakt nutzen
* Favicon: identisch zur Homepage, weißes „That's it.“ mit orangenem Punkt auf transparentem Grund (`public/favicon.png` 512px, Quelle `thatsit_homepage_new/public/favicon.png`), daraus `favicon.ico` (16, 32, 48), `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` auf Schwarz, `site.webmanifest`. Das alte L Favicon (`favicon.svg`) ist entfernt. Hinweis: wie auf der Homepage ist das transparente Favicon in hellen Browsertabs kaum sichtbar. Diese Pfade stehen in `RESERVIERTE_SLUGS`
* Bilder: jedes `<img>` hat Alt Text und `title` (Logos, Avatare im Backoffice, Mailkopf)
* Logos That's it. Marketing (Original): `public/images/brand/logo-schwarz.*` und `logo-weiss.*` (aus dem Branding Guide extrahiert). `logo-schwarz.webp` steht in der Terminkachel rechts neben „Dein Termin“, im Kopfbereich auf dem Bürofoto steht kein Logo mehr
* Bilder aus dem Repository der neuen Homepage (`Thatsitmarketing/thatsit_homepage_new`, `src/assets/bilder`): Besprechungsraum mit Logowand `buero-tisch.jpg` als `public/images/buero/besprechungsraum-1200.webp` und `-2400.webp` (Seitenhintergrund, abgedunkelt, ab 1000px die große Datei, auf Desktop fixiert), `start/team-held.jpg` als `public/images/team/team-besprechung.webp` (derzeit nicht eingebunden), Playbook Mockups als `public/images/unterlagen/*.webp` (nur noch als Vorschaubild im Terminart Editor hinterlegt, auf der Buchungsseite nicht sichtbar). Die Teamportraits sind seit 2026-10-27 entfernt

## Komponenten und wo sie liegen

| Datei | Inhalt |
| --- | --- |
| `src/styles/global.css` | Basis, Knöpfe (`.knopf`, `--orange`, `--rahmen`, `--leise`, `--gefahr`, `--klein`), Felder, Schalter, Badges, Pillen, Hinweise, Karten |
| `src/layouts/Basis.astro` | HTML Grundgerüst, Meta, Preload der Schriften |
| `src/layouts/Oeffentlich.astro` | Kopf und Fuß der öffentlichen Seiten, Embed Modus mit Höhenmeldung an das Widget |
| `src/layouts/App.astro` | Backoffice mit schwarzer Seitenleiste, mobilem Menü, Kopierknöpfen, Rückfragen |
| `src/layouts/Zugang.astro` | Login und Einrichtung |
| `src/components/BuchungsSeite.astro` | Öffentliche Buchung: mittig zentrierter Kopf auf dem Bürofoto (Eyebrow, „Lass uns reden.“, Text darunter), darunter mittig die Karte (max. 1240px) mit Kalender (Tage 42px hoch), Zeiten und Formular links. Rechts „Dein Termin“ mit Logo That's it., Dauer, Ort, Beschreibung (Zeilen nach einer Zeile mit Doppelpunkt werden Hakenliste) und Kontaktzeile. Seite bis 1440px breit, ab 1180px zweispaltig |
| `src/lib/marke.ts` | Kontakt (info@, Telefon), Standardtext unter „Lass uns reden.“ |
| `src/components/TerminartFormular.astro` | Editor der Terminarten inklusive Fragenliste und Unterlagenliste (Titel, Link, Kurzinfo, Vorschaubild), ab 1400px zweispaltig |
| `src/components/Kalender.astro` | Backoffice Kalender, Woche und Monat: Verfügbarkeit weiß, nicht buchbar schraffiert, Termine als Blöcke in Terminartfarbe, Google Belegtzeiten gestrichelt, orangene Jetzt Linie. Navigation über URL (`kal`, `datum`), Anker `#kalender` |
| `src/components/ui/Logo.astro` | Let's Meet Logo, Props `variante` (`schwarz`, `weiss`), `form` (`voll`, `kompakt`), `hoehe`, `href`, `klasse`. Genutzt im öffentlichen Kopf (44px), in der Seitenleiste (44px, mobil 150px breit) und groß auf Login und Einrichtung |
| `src/components/Avatar.astro`, `OrtIcon.astro`, `ui/Icon.astro` | Kleinteile |
| `src/scripts/buchung.ts` | Kalender, Zeitzonen, Slotwahl und Formularversand im Browser |
| `public/embed.js` | Widget ohne Abhängigkeiten, API `LetsMeet.initInlineWidget`, `initBadgeWidget`, `showPopupWidget`, `closePopupWidget`, Ereignis `letsmeet:gebucht` |

Logik in `src/lib/`: `abfragen.ts` (unter anderem `buero()`, `LOGIN_KONTO`, `unterlagenLesen`), `slots.ts` (freie Zeiten), `kalender.ts` (Kalenderdaten je Tag: Verfügbarkeit, Termine mit Spaltenverteilung bei Überschneidung, Google freeBusy ohne die eigenen Buchungen), `zeit.ts` (Zeitzonen ohne Bibliothek), `buchungen.ts` (anlegen, absagen, umbuchen, Mails, Webhook, Cron), `google.ts`, `mail.ts` (Vorlagen), `ics.ts`, `auth.ts`, `konten.ts`, `terminart-formular.ts`, `termin-filter.ts`.

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

Anmeldung Backoffice: Passwort als PBKDF2 SHA256 (100.000 Iterationen), Sitzung als HMAC signiertes Cookie `lm_sitzung` (HttpOnly, SameSite Strict, 8 Stunden), Sperre 15 Minuten nach 5 Fehlversuchen, CSRF Schutz über Astro `checkOrigin`. Der Google Rückruf liegt außerhalb von `/api/app`, weil das Strict Cookie bei der Rückleitung von Google nicht mitkommt. Die Zuordnung läuft über einen signierten state mit eigenem Zweck, er ist nie als Sitzung gültig. Der Rückruf leitet danach nicht per 302, sondern über eine kleine Seite mit meta refresh weiter, sonst zählt die ganze Kette als von Google ausgelöst und das Strict Cookie fehlt auch auf `/app/integrationen` (Folge: Loginmaske). Fehler landen als `?google_fehler=` mit Code (`abgelehnt`, `state`, `kein_refresh`, `invalid_client`, `invalid_grant`, `redirect_uri_mismatch`, `speichern`) und werden unter Integrationen im Klartext erklärt. Client ID und Secret werden vor der Nutzung getrimmt.

Webhook Ereignisse: `buchung.erstellt`, `buchung.umgebucht`, `buchung.storniert`, `test`. Header `x-letsmeet-signatur` = HMAC SHA256 des Rohkörpers mit dem Signaturschlüssel.

Datenbank: `migrations/0001_grundschema.sql` mit den Tabellen `nutzer`, `terminarten`, `verfuegbarkeit`, `ausnahmen`, `buchungen`. `migrations/0002_zentrales_buero.sql`: Spalten `nutzer.ist_buero` und `terminarten.unterlagen` (JSON `[{titel, url, info, bild}]`). Macht das Konto `info@thatsit.marketing` zum Büro (Name „That's it. Marketing“, Position „Büro Gelsenkirchen“) oder legt es ohne Anmeldung an (`passwort_hash = '!'`), ergänzt Standardverfügbarkeit Mo bis Fr 9 bis 17 Uhr und ein Erstgespräch, füllt dessen Beschreibung und Unterlagen (vier Playbooks, Referenzen), falls leer, und setzt persönliche Terminarten der übrigen Konten auf inaktiv (Daten bleiben). Login und Einrichtung zählen nur Konten mit echtem Passwort (`LOGIN_KONTO`). Neue Konten bekommen keine eigenen Terminarten mehr.

Unterlagen zur Vorbereitung: seit 2026-10-27 nicht mehr auf der Buchungsseite. Feld `terminarten.unterlagen` und die Liste im Terminart Editor bleiben bestehen (Daten: vier Playbooks, verlinkt auf `*-playbook.thatsit.marketing`), werden aber öffentlich nicht angezeigt. Der Filter nach Interesse (`src/lib/themen.ts`, `?thema=`) ist entfernt. Keine IP Adressen, keine User Agents. Löschfrist `loeschen_ab` 365 Tage nach Terminende, der Cron löscht.

### Schnittstelle zur Homepage (Kontakt Funnel)

Der vierstufige Kontakt Funnel der Homepage (`Thatsitmarketing/thatsit_homepage_new`, `src/components/ui/KontaktFunnel.astro`, Link in `src/daten/letsmeet.ts`) sendet die Anfrage wie bisher an `/api/kontakt` und leitet danach auf `/erstgespraech#name=...&email=...&telefon=...&nachricht=...&quelle=website {variante}` weiter. `src/scripts/buchung.ts` liest das Fragment, entfernt es sofort aus der Adresszeile (`history.replaceState`) und füllt Name, E Mail, Telefon und „Was sollen wir vorab wissen?“ (Unternehmen, Website, Teamgröße, Interesse) im Formularschritt vor, mit Hinweis „Deine Angaben von unserer Website sind schon eingetragen“. `quelle` landet in `buchungen.quelle`. Das Fragment geht nie an einen Server, die Daten stehen also in keinem Log. Telefonfeld ist immer sichtbar (Pflicht nur bei „Telefon, wir rufen an“), Nummern mit Bindestrich sind erlaubt.

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
* Prüfen, ob Workers Builds nach dem Merge von PR #7 aus `main` deployt hat (Startseite zeigt „Lass uns reden.“ auf dem Bürofoto). Die D1 ist bereits auf Stand 0002
* Das Konto info@thatsit.marketing heißt jetzt „That's it. Marketing“. Wer sich bisher persönlich damit angemeldet hat (bisher Name Tim Barela), bekommt unter Team ein eigenes Konto
* Google Kalender unter Integrationen mit info@thatsit.marketing verbinden (bisher ist nur Mikes persönlicher Kalender verbunden, der zählt nicht mehr)
* Klären, ob die Liste „Unterlagen zur Vorbereitung“ im Terminart Editor ganz raus soll, seit sie auf der Buchungsseite nicht mehr erscheint
* Branch `claude/affectionate-pasteur-q3ennq` (PR #8) ist veraltet (ein Commit nur an der CLAUDE.md, Inhalt hier übernommen). PR #8 schließen statt mergen, Branch danach löschen
* Secrets in Cloudflare setzen, Resend Domain verifizieren, Turnstile Widget anlegen
* Google OAuth Client anlegen (Anleitung oben). Google Verbindung, freeBusy und Meet Links sind mangels Zugang in der Entwicklung nicht live getestet
* Datenschutzerklärung auf thatsit.marketing um Let's Meet ergänzen (Zweck, Rechtsgrundlage, Speicherdauer 12 Monate, Empfänger Cloudflare, Resend, Google)
* Recruiting Funnel der Homepage (`/api/lead`) ist noch nicht an Let's Meet angebunden
* `pnpm db:migrate:remote` bzw. der Deploybefehl überspringen 0003, weil sie bereits auf der D1 eingespielt und vermerkt ist
* Optional später: Rundenverteilung im Team, mehrere Verfügbarkeitspläne pro Person, Zahlungen, Microsoft Kalender

## Änderungsverlauf mit Datum

* 2026-10-26: Erstversion. Buchungsseiten, Widget, Backoffice (Terminarten, Termine, Verfügbarkeit, Einbetten, Integrationen, Einstellungen, Team), Google Kalender, Resend Mails mit ICS, Webhooks, Cron für Erinnerungen und Löschfristen. Build, Typprüfung, Klickstrecke und Responsive Check in fünf Breiten lokal geprüft
* 2026-10-26: D1 Datenbank `terminethatsitmarketing` verknüpft, Workername `let-s-meet`, Deploybefehl inklusive Migrationen, Anleitung für Workers Builds
* 2026-10-26: Hinweis ergänzt, dass die Google Weiterleitungs URI zur aufgerufenen Domain passen muss (Ursache für `redirect_uri_mismatch`)
* 2026-10-26: Domain festgelegt auf `letsmeet.thatsit.marketing` (vorher Vorschlag `termine.thatsit.marketing`), angepasst in `astro.config.mjs`, `wrangler.jsonc`, `public/embed.js` und Anleitung. Google Weiterleitungs URI: `https://letsmeet.thatsit.marketing/api/google/rueckruf`
* 2026-10-26: Backoffice überarbeitet: volle Breite statt 1180px, neuer Kalender (Woche und Monat) mit Terminen, Verfügbarkeit, Ausnahmen und Google Belegtzeiten auf Termine (Standard Tab) und Verfügbarkeit, Live Vorschau der Wochenzeiten, Tagesklick legt Ausnahme an, Terminart Editor sowie Einstellungen und Integrationen zweispaltig, Feldausrichtung in Formularrastern korrigiert. Lokal mit Testdaten in 390, 1024, 1440 und 2000px geprüft
* 2026-10-26: Google Verbindung repariert: nach der Freigabe landete man auf der Loginmaske und die Verbindung wurde nicht gespeichert, ohne sichtbaren Grund. Rückruf leitet jetzt per meta refresh weiter (Sitzung bleibt erhalten), zeigt den genauen Fehlergrund von Google an und trimmt Client ID und Secret
* 2026-10-26: Eigenes Logo „Let's Meet.“ im Stil des That's it. Marketing Logos (Schwarz, Weiß, kompakt, PNG für Mails) und neues Favicon Set (SVG, ICO, Apple Touch Icon, 192 und 512px, Webmanifest). Eingebunden in Kopf, Seitenleiste, Login, Einrichtung und Mailkopf, der Text „Let's Meet.“ neben dem alten Logo entfällt. Build, Typprüfung und Sichtprüfung in 390 und 1440px lokal
* 2026-10-26: Schema `0001_grundschema.sql` auf die D1 `terminethatsitmarketing` eingespielt und in `d1_migrations` vermerkt, damit `wrangler d1 migrations apply` es nicht doppelt ausführt (übernommen aus Branch `claude/affectionate-pasteur-q3ennq`)
* 2026-10-27: Umbau auf zentrale Buchung über das Büro info@thatsit.marketing statt einzelner Mitarbeiter. Neue Startseite mit Kalender und direkt sichtbaren freien Zeiten, rechts Beschreibung und Unterlagen zur Vorbereitung (Playbooks, Referenzen), Teamleiste mit Foto und Portraits, Bürofoto aus dem Homepage Repository als Hintergrund. Neue Adressen `/{terminart}`, alte Personenlinks leiten weiter. Backoffice arbeitet für alle angemeldeten Konten auf dem Büro (Terminarten, Termine, Verfügbarkeit, Einbetten, Integrationen), Einstellungen mit Karte für die Buchungsseite, Unterlagen im Terminart Editor, Migration 0002. Geprüft lokal mit Abbild der echten D1 Daten: Migration, Typprüfung, Build, Buchung bis Bestätigungsseite, alle Backofficeseiten, Screenshots in 390, 900 (Embed), 1024, 1440 und 2000px ohne horizontales Scrollen. Lokal nur Node 22.22 vorhanden, Astro daher direkt über `dist/cli` gestartet
* 2026-10-27: Migration `0002_zentrales_buero.sql` auf die D1 `terminethatsitmarketing` eingespielt und in `d1_migrations` vermerkt. Ergebnis: info@thatsit.marketing ist Büro („That's it. Marketing“, Büro Gelsenkirchen) mit Erstgespräch inklusive Beschreibung und fünf Unterlagen, Verfügbarkeit Mo bis Fr 9 bis 17 Uhr. Erstgespräche von Mike und Victor inaktiv. Keine Buchungen betroffen (es gab keine)
* 2026-10-27: Schnittstelle zum Kontakt Funnel der Homepage: Vorbelegung über das Fragment der Adresse (Name, E Mail, Telefon, Nachricht, Quelle), Telefonfeld immer sichtbar, Bindestrich in Telefonnummern erlaubt. Lokal geprüft: Funnel ausgefüllt, Weiterleitung, Felder vorausgefüllt, Buchung mit allen Angaben gespeichert. Typprüfung ohne Fehler
* 2026-10-27: Erstgespräch des Büros in der D1 auf 60 Minuten gestellt, wie auf der Homepage versprochen (Beschreibung „In 60 Minuten“)
* 2026-10-27: Buchungsseite kompakter, damit alles in einem Blickfeld liegt: Logo Let's Meet überall ohne Unterzeile „THAT'S IT. MARKETING“ (auch Seitenleiste, Login, Mailkopf mit neuem `letsmeet-kompakt-weiss.png`), Logo That's it. aus dem Kopfbereich in die Terminkachel neben „Dein Termin“ verschoben, Überschrift und Text im Kopf nebeneinander, Kalendertage flacher, Seite bis 1440px breit. Unterlagen stehen als Kacheln unter dem Kalender und werden nach dem Interesse aus der Anfrage gefiltert, Referenzen entfernt (Migration 0003, auf der D1 eingespielt und in `d1_migrations` vermerkt, Erstgespräch hat jetzt vier Unterlagen). Teamfoto entfällt, Portraits stehen in der Zeile „Mit unserem Team“. Favicon wie auf der Homepage (That's it.). Alt Text und Titel an allen Bildern. Lokal geprüft: Typprüfung, Build, Screenshots in 390, 900 (Embed), 1024, 1280, 1440 und 1920px ohne horizontales Scrollen, Filter mit Funnel Fragment und `?thema=`, Buchung bis Bestätigungsseite
* 2026-10-27: Playbooks („Unterlagen zur Vorbereitung“) und Teamportraits samt Zeile „Mit unserem Team“ von der Buchungsseite entfernt, ebenso der Filter nach Interesse (`src/lib/themen.ts`, `?thema=`), `TEAM` aus `marke.ts` und die Portraitdateien. Daten der Unterlagen in der D1 und der Editor bleiben. Lokal geprüft: Typprüfung, Build, Startseite in 390 und 1440px ohne horizontales Scrollen
* 2026-10-27: Stil an die Homepage angelehnt: Kopfleiste mit orangener Linie oben und kleinerem Logo (26px), dunkler Fuß mit „© 2026 That's it. Marketing · Alle Rechte vorbehalten“ und Impressum/Datenschutz, Überschrift und Text mittig über der zentrierten Buchungskarte (Kopf, Karte und Fuß bündig auf 1240px). Nicht visuell geprüft (node_modules fehlen in dieser Sitzung)
* 2026-10-27: Öffentlicher Kopf wieder mit vollem Logo „Let's Meet.“ samt Unterzeile „THAT'S IT. MARKETING“ (34px Höhe, Buchstaben so groß wie zuvor), Inhalt der Buchungsseite weiter nach unten gesetzt (mehr Abstand zur Kopfleiste, weniger Leerraum bis zum Fuß). Nicht visuell geprüft
