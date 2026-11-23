# WhatsApp Bot: Einrichtung

Der Bot schreibt Leads der Landingpage „Kostenloser Website-Entwurf“ an, die im Formular den Haken für WhatsApp gesetzt haben, stellt die Settingfragen und bucht das Strategiegespräch mit Tim direkt in Let's Meet (Google Meet). Code: `src/lib/whatsapp/`, Schnittstellen `/api/whatsapp/lead` und `/api/whatsapp/webhook`, Übersicht im Backoffice unter **WhatsApp Bot**.

Präsentation zum Vorstellen im Team: `docs/praesentation/WhatsApp-Setting-Bot.pdf` (15 Folien, 16:9, mit dem Chat im Wortlaut aus `TEXTE`). Quelle ist `docs/praesentation/whatsapp-bot.html`, gerendert mit Playwright als PDF im Format 1920 × 1080; bei Änderungen am Ablauf beide nachziehen.

## 1. Firmennummer mit der Cloud API verbinden (Coexistence)

1. Meta Business Suite öffnen, unter Einstellungen das Unternehmen prüfen lassen (Unternehmensverifizierung). Ohne sie gilt die Grenze von 250 neuen Kontakten pro Tag, das reicht für den Start.
2. developers.facebook.com, „App erstellen“, Typ **Business**, Anwendungsfall **WhatsApp**. Die App mit dem Business Portfolio von That's it. Marketing verknüpfen.
3. In der App unter WhatsApp, „Erste Schritte“ bzw. API Setup, „Telefonnummer hinzufügen“: in der Praxis (Stand 2026-11) bietet dieser Dialog nur **SMS** oder **Anruf** an, also eine reine API Registrierung. Das würde die Nummer aus der WhatsApp Business App nehmen. Diesen Weg nicht fortsetzen, wenn die Nummer in der App bleiben soll. Eine Option „Bestehende WhatsApp Business App Nummer verbinden“ direkt im Dashboard war nicht zu finden.
4. Stattdessen Abschnitt **1a** unten: die interne Seite `/app/whatsapp/coexistence` nutzt Embedded Signup, den einzigen Weg, der Coexistence tatsächlich anbietet. Dort am Firmenhandy in der WhatsApp Business App die Verbindung bestätigen und den Chatverlauf übernehmen. Die Nummer bleibt in der App nutzbar, das Team kann weiter normal schreiben.
5. Wichtig für Coexistence: die WhatsApp Business App mindestens alle 14 Tage einmal öffnen, sonst trennt Meta die Verbindung.
6. Unter WhatsApp, API Setup die **Phone number ID** notieren (nicht die Telefonnummer selbst), falls die Seite aus Abschnitt 1a sie nicht schon angezeigt hat.

### 1a. Coexistence über die interne Seite /app/whatsapp/coexistence (Embedded Signup)

Seit 2026-11-19 gibt es dafür eine Admin Seite im Backoffice, weil der normale Anmeldedialog im Meta Dashboard keine Coexistence Option bietet (siehe Schritt 3 oben). Der einzige Weg ist **WhatsApp Embedded Signup**. Seit 2026-11-23 ruft die Seite Embedded Signup v5 auf (`extras.version: "v5"`, dort ist Coexistence Standard) und gibt zusätzlich `featureType: "whatsapp_business_app_onboarding"` mit. Die alte Angabe `sessionInfoVersion: "3"` ist raus: Meta hat v2 und v3 am 15.10.2026 abgekündigt und beantwortet sie nur noch als v4. v5 meldet im Ereignis `messaging_account_ids` statt `waba_id`, die Seite nimmt die erste ID als WABA ID.

Voraussetzungen, bevor der Knopf etwas bringt:

* Business Portfolio That's it. Marketing ist bei Meta verifiziert (Unternehmensverifizierung).
* Eine Meta App mit Anwendungsfall WhatsApp existiert im Portfolio (App „Chat Bot That's it.", App ID in `WHATSAPP_APP_ID`).
* Eine Facebook Login for Business Konfiguration für Embedded Signup ist angelegt (Konfigurations ID in `WHATSAPP_EMBEDDED_CONFIG_ID`), mit den Rechten `whatsapp_business_management` und `whatsapp_business_messaging`.
* `WHATSAPP_APP_SECRET` ist als Secret im Worker **let-s-meet** gesetzt (App Einstellungen, Allgemein, App Secret bei Meta).
* Die WhatsApp Business App am Firmenhandy ist Version 2.24.17 oder neuer, die Nummer ist dort nicht abgemeldet.
* Die App ist bei Meta **Tech Provider** (oder Solution Partner). Ohne diesen Status bietet Embedded Signup keine Coexistence an, laut Meta Doku Pflicht.
* Die Login Konfiguration ist vom Typ **WhatsApp Embedded Signup** (Vorlage „WhatsApp Embedded Signup Configuration With 60 Expiration Token“ oder eigene Konfiguration mit dieser Login Variante). Eine normale Facebook Login Konfiguration reicht nicht.
* Die Rechte `whatsapp_business_management` und `whatsapp_business_messaging` haben erweiterten Zugriff (App Review), sonst lassen sich nur Konten mit Rolle in der App verbinden.

**Popup zeigt nur „Du hast keine vorhandenen Telefonnummern. Erstelle eine neue.“ mit SMS oder Anruf:** Das ist der normale Ablauf für eine neue Nummer, Meta bietet dann keine Coexistence an. Fenster schließen, nicht auf Weiter, sonst verschwindet die Nummer aus der App. Bei Coexistence ersetzt Meta die Kontoauswahl durch die Option, die bestehende WhatsApp Business App zu verbinden. Prüfen in dieser Reihenfolge: Tech Provider Status der App, Typ der Login Konfiguration (`WHATSAPP_EMBEDDED_CONFIG_ID`), erweiterter Zugriff, Version der WhatsApp Business App, ob Coexistence für Deutschland und das Konto freigeschaltet ist.

Ablauf: `/app/whatsapp/coexistence` öffnen (nur Admins), Knopf „WhatsApp Firmennummer verbinden“. Im Popup von Meta die Option wählen, eine bestehende Nummer aus der WhatsApp Business App zu übernehmen, Firmennummer eingeben, am Firmenhandy die Nachricht vom Facebook Business Konto bestätigen (Verbinden, Chatverlauf teilen) und den Code von WhatsApp im Fenster eingeben. Die Seite zeigt den Fortschritt live (aus dem `postMessage` Ereignis `WA_EMBEDDED_SIGNUP` des Popups) und meldet am Ende WABA ID und Phone Number ID.

Technisch: `FB.login()` liefert nach „Fertig“ einen Code, der nur 5 Minuten gültig ist. Die Seite schickt ihn an `POST /api/app/whatsapp/onboarding` (nur angemeldet, nur Admin), die Route tauscht ihn server seitig gegen einen dauerhaften Business Token ein (`GET /oauth/access_token` mit `WHATSAPP_APP_ID` und `WHATSAPP_APP_SECRET`) und meldet die App gleich an der WABA an (`POST /<waba_id>/subscribed_apps`), damit Webhooks ankommen. Der Token selbst geht nie an den Browser und nie ins Protokoll, nur Erfolg oder Fehler.

Die Seite zeigt den Business Token aus dieser Schnittstelle **bewusst nicht an**, auch nicht im Protokoll, nur dass der Austausch geklappt hat. Grund: dieser Token kommt vom automatischen Codeaustausch und ist für die serverseitige Anmeldung des Webhooks gedacht (`subscribed_apps`, macht die Seite gleich mit), nicht zum Abschreiben gemacht. Für den Wert, der als `WHATSAPP_TOKEN` in Cloudflare landet, weiter mit Abschnitt 2 (Systemnutzer): dort zeigt Meta den Token einmal im Klartext zum Kopieren, genau für diesen Zweck.

Danach noch zu tun, damit der Bot wirklich läuft:

1. Abschnitt 2 (Systemnutzer, dauerhafter Token zum Abschreiben) durchgehen und `WHATSAPP_TOKEN` in Cloudflare setzen.
2. Die **Phone number ID**, die die Seite nach dem Verbinden anzeigt, als `WHATSAPP_PHONE_NUMBER_ID` in Cloudflare setzen.
3. Weiter mit Abschnitt 3 (Vorlagen einreichen) und Abschnitt 6 (Webhook bei Meta eintragen).
4. Zahlungsmethode im WhatsApp Manager hinterlegen, sonst sperrt Meta den Versand nach der Testphase.

## 2. Dauerhaften Zugangsschlüssel anlegen

1. Business Einstellungen, Nutzer, **Systemnutzer** anlegen (Rolle Admin), der App und dem WhatsApp Konto zuweisen.
2. „Token generieren“, App auswählen, Ablauf **Nie**, Berechtigungen `whatsapp_business_messaging` und `whatsapp_business_management`.
3. Unter App Einstellungen, Allgemein das **App Secret** anzeigen und notieren.

## 3. Vorlagen einreichen

**Seit 2026-11-21 per Knopf:** Backoffice, WhatsApp Bot, „Vorlagen“ (`/app/whatsapp/vorlagen`, nur Admins). Die Seite reicht alle vier Vorlagen über die Graph API (`POST /{waba-id}/message_templates`) bei Meta ein und zeigt ihren Status. Text und Knöpfe kommen direkt aus `TEXTE` in `bot.ts`, es wird also genau eingereicht, was der Bot sendet. Konto ist `WHATSAPP_WABA_ID` (derzeit das Testkonto), auf der Seite überschreibbar. Braucht `WHATSAPP_TOKEN` mit `whatsapp_business_management`. Die Seite ist auch das Video für die App Review dieser Berechtigung.

Von Hand geht es weiter so: WhatsApp Manager, Nachrichtenvorlagen, „Vorlage erstellen“. Kategorie **Marketing**, Sprache **Deutsch (de)**. Name und Text genau so übernehmen, Variablen als `{{1}}`, `{{2}}`. Knöpfe als **Schnellantwort** in genau dieser Reihenfolge.

**entwurf_start_website**

> Hi {{1}}, hier ist das Team von That's it. Marketing 👋 Danke für deine Anfrage zum kostenlosen Website-Entwurf für {{2}}! Damit wir den Entwurf genau auf euch zuschneiden: Was stört dich an eurer jetzigen Website am meisten?

Knöpfe: `Wirkt veraltet`, `Bringt kaum Anfragen`, `Etwas anderes`. Beispielwerte: Max, Testbau GmbH.

**entwurf_start_ohne_website**

> Hi {{1}}, hier ist das Team von That's it. Marketing 👋 Danke für deine Anfrage zum kostenlosen Website-Entwurf für {{2}}! Damit wir den Entwurf genau auf euch zuschneiden: Wie kommen eure Kunden aktuell auf euch?

Knöpfe: `Über Empfehlungen`, `Über Social Media`, `Anders`.

**entwurf_nachfass**

> Hi {{1}}, kurze Erinnerung an deinen kostenlosen Website-Entwurf 🙂 Damit wir starten können, brauchen wir nur zwei, drei kurze Antworten von dir. Passt es gerade?

Knöpfe: `Ja, los geht's`, `Später`.

**termin_erinnerung** (Kategorie **Utility**)

> Hi {{1}}, kurze Erinnerung: Morgen, {{2}}, stellt dir Tim deinen Website-Entwurf vor. Den Link zum Google Meet findest du in deiner Bestätigungsmail. Wir freuen uns auf dich!

Keine Knöpfe. Beispielwerte: Max, 23. November um 09:00 Uhr.

Die Knöpfe schicken dem Bot Payloads (`p_veraltet`, `p_anfragen`, `p_anderes`, `p_empfehlungen`, `p_social`, `n_los`, `n_spaeter`), die der Code beim Senden mitgibt. Wird ein Name geändert, gehört er in `VORLAGEN` in `src/lib/whatsapp/bot.ts`, ein Text in `TEXTE` (dort steht er für das Protokoll im Backoffice).

## 4. Profil der Nummer

WhatsApp Manager, Telefonnummern, Profil. Beschreibung zum Beispiel:

> Webdesign und Marketing aus Gelsenkirchen. Wir antworten teilweise mit digitaler Unterstützung, unser Team liest jede Nachricht mit.

## 5. Schlüssel in Cloudflare setzen

Worker **let-s-meet**, Einstellungen, Variablen und Geheimnisse, jeweils als **Secret**:

| Name | Wert |
| --- | --- |
| `WHATSAPP_TOKEN` | Token des Systemnutzers aus Schritt 2 |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ID aus Schritt 1 |
| `WHATSAPP_APP_SECRET` | App Secret aus Schritt 2 |
| `WHATSAPP_VERIFY_TOKEN` | frei gewähltes Wort, mindestens 16 Zeichen, gleich in Schritt 6 eintragen |
| `WHATSAPP_LEAD_SCHLUESSEL` | frei gewählt, mindestens 24 Zeichen, gleich als `BOT_SCHLUESSEL` bei der Landingpage |
| `ANTHROPIC_API_KEY` | Schlüssel aus console.anthropic.com (Organisation That's it. Marketing) |

Pages Projekt der Landingpage (`ad_web_entwurf_landingpage`): Secret `BOT_SCHLUESSEL` mit demselben Wert wie `WHATSAPP_LEAD_SCHLUESSEL`. `LETSMEET_BOT_URL` steht schon in `wrangler.toml`.

Workers AI (Sprachnachrichten) braucht keinen Schlüssel, die Bindung `AI` steht in `wrangler.jsonc`.

## 6. Webhook bei Meta eintragen

App, WhatsApp, Konfiguration:

1. Rückruf URL: `https://letsmeet.thatsit.marketing/api/whatsapp/webhook`
2. Verifizierungstoken: der Wert von `WHATSAPP_VERIFY_TOKEN`
3. „Bestätigen und speichern“, danach die Felder **messages** und **smb_message_echoes** abonnieren. Ohne `smb_message_echoes` merkt der Bot nicht, wenn das Team aus der App selbst schreibt.

## 7. Test

1. Auf der Landingpage mit der eigenen Handynummer und Haken bei WhatsApp anfragen (zwischen 8 und 21 Uhr, nachts plant der Bot die erste Nachricht für den Morgen).
2. Im Backoffice unter WhatsApp Bot den Verlauf ansehen. Ein gebuchter Termin steht unter Termine mit der Herkunft „WhatsApp Bot“.
3. Testtermin danach absagen, den Chat mit „Stopp“ beenden.

## Verhalten

* Erste Nachricht sofort, nachts und am Wochenende vor 10 Uhr erst morgens (wochentags 8 bis 21 Uhr, Wochenende 10 bis 20 Uhr).
* Keine Antwort: nach 3 Stunden `entwurf_nachfass`, nach 24 Stunden Mail ans Team „bitte anrufen“.
* Mitten im Gespräch still: nach 2 und nach 18 Stunden nachhaken, danach Mail ans Team.
* Termine: normal frühestens 7 Tage nach der Anfrage, heiß („So schnell es geht“ und Budget passt) nach 3 Werktagen, nie am Wochenende oder an Feiertagen in NRW. Zwei Vorschläge an verschiedenen Tagen oder Wunschzeit.
* Budget „Kommt drauf an“ oder „Eher zu viel“: Einwandbehandlung über Claude nach dem Setting Skript, höchstens zwei Anläufe. Klares Nein danach: höfliche Verabschiedung. Weiter unsicher: Termin wird trotzdem angeboten. Der zweite Anlauf wiederholt nie den ersten (`src/lib/whatsapp/einwand.ts`): ohne Claude oder bei verworfener Antwort gibt es je Anlauf einen eigenen festen Text (1 Wert eines neuen Kunden, 2 Entwurf und Gespräch kostenlos und unverbindlich), und eine Antwort, die einer der letzten Nachrichten des Bots gleicht, wird gegen den nächsten Text getauscht.
* Das Team schreibt aus der App in den Chat: der Bot pausiert dort. Im Backoffice lässt er sich wieder einschalten.
* „Stopp“ meldet ab, die Nummer wird nie wieder angeschrieben. Ausnahme: Admins können sie unter `/app/whatsapp/{id}` mit „Für den Bot freischalten“ wieder freigeben (`botFreischalten`), etwa wenn der Kunde ausdrücklich doch wieder Nachrichten möchte. Der Bot schreibt danach nicht von sich aus, sondern macht erst weiter, wenn der Kunde schreibt, beim Schritt, bei dem er Stopp geschrieben hat. Nachhaken und „bitte anrufen“ bleiben bis dahin aus. Ist das Gespräch schon gelöscht (nur die Sperre übrig), fällt die Sperre weg und die Nummer startet bei der nächsten Anfrage wie neu.
* Fremde Nummern (normale Kundenchats auf der Firmennummer) ignoriert der Bot komplett und speichert nichts. Ausnahme: Interessenten der Landingpage, die selbst zuerst schreiben (nächster Abschnitt).
* Am Vortag eine Erinnerung per WhatsApp, zusätzlich zu den Mails aus den Arbeitsabläufen.

## Interessent schreibt selbst zuerst (seit 2026-11-23)

Wer im Funnel „Per Anruf“ wählt, bekommt auf der Dankesseite und in der Bestätigungsmail einen Knopf, der WhatsApp an die Firmennummer mit diesem Text öffnet:

> Hallo, ich habe gerade meinen kostenlosen Website-Entwurf angefragt (Anfrage XXXXXX). Gerne per WhatsApp weiter.

`XXXXXX` ist die Anfragenummer (sechs Zeichen aus `ABCDEFGHJKMNPQRSTUVWXYZ23456789`). Sie kommt über `/api/anfrage` in den Antworten an (`Anfragenummer`, dazu `Kontaktweg` = `Anruf` oder `WhatsApp`), bei WhatsApp Leads zusätzlich als `referenz` an `/api/whatsapp/lead`. Weil der Kunde zuerst geschrieben hat, ist das Servicefenster von 24 Stunden offen: der Bot antwortet frei, ohne Vorlage und ohne Einwilligung aus dem Formular.

Ablauf bei einer eingehenden Nachricht ohne laufendes Gespräch (`selbstGeschrieben` in `bot.ts`, Suche in `zuordnung.ts`):

1. Absendernummer gegen die Telefonnummer der Anfragen der letzten 30 Tage (normalisiert, „0170 …“ = „+49 170 …“ = wa_id `49170…`).
2. Sonst die Anfragenummer im Text (`Anfrage XXXXXX`, auch „Anfrage: …“, „Anfragenummer …“), Anfragen der letzten 90 Tage.
3. Treffer: Gespräch mit Name, Firma, E-Mail und Website aus der Anfrage anlegen, Begrüßung mit Namen und Firma, danach das normale Setting ab „Was stört“. Die Anfrage gilt als „Per WhatsApp übernommen“ (Pille unter Anfragen mit Link zum Chat, `anfragen.whatsapp_gespraech_id`), an Close geht `anfrage.whatsapp_uebernommen`.
4. Kein Treffer, aber erkennbar der Text der Landingpage (Anfragenummer oder „Website-Entwurf“): der Bot fragt nach Name und Firma (E-Mail darf mit), dann ob es schon eine Website gibt, danach das normale Setting. Im Backoffice steht das Gespräch als „Nicht zugeordnet“. Fehlt bis zur Terminwahl die E-Mail, fragt der Bot vor dem Buchen danach.
5. Alles andere ist ein normaler Kundenchat: der Bot schweigt und speichert nichts.

Dubletten wie bisher: eine Nummer bekommt in 30 Tagen kein zweites Gespräch, nach „Stopp“ nie wieder. Ein abgeschlossenes Gespräch, das älter als 30 Tage ist, und eine neuere Anfrage ergeben ein neues Setting. Schreibt ein WhatsApp Lead von einer anderen Nummer mit seiner Anfragenummer und hat im ersten Chat noch nicht geantwortet, zieht das Gespräch auf die neue Nummer um, sonst bekommt das Team eine Mail. Schickt jemand den vorausgefüllten Text im laufenden Gespräch noch einmal, wiederholt der Bot nur die offene Frage.

Herkunft je Gespräch: `wa_gespraeche.zuordnung` = `formular`, `nummer`, `anfragenummer` oder `keine`, die Anfragenummer in `referenz`, die Anfrage in `anfrage_id` (Migration `0017_whatsapp_zuordnung.sql`).

**Close Automat:** muss das Ereignis `anfrage.whatsapp_uebernommen` (Felder `anfrage_id`, `name`, `email`, `telefon`, `whatsapp`, `anfragenummer`, `zuordnung`, `chat`) noch verarbeiten, etwa als Notiz und indem die Anrufaufgabe des Leads erledigt wird. Bis dahin sieht man die Übernahme sicher nur in Let's Meet (wie der Automat ein unbekanntes Ereignis behandelt, ist aus diesem Repo nicht geprüft).

Tests: `pnpm test` (Node 24, `tests/zuordnung.test.ts`, prüft beide Zuordnungswege mit der echten SQL gegen SQLite).

## Sicherheit und Schutz vor Missbrauch

Code: `src/lib/whatsapp/schutz.ts`, eingebunden in `ki.ts`, `bot.ts`, `meta.ts` und den beiden Schnittstellen.

* **Claude hat keine Macht.** Keine Werkzeuge, kein Zugriff auf Datenbank, Kalender oder Mails. Ablauf, Fragen, Knöpfe, Preise und Buchung stehen im Code. Claude liefert nur eine Einordnung aus einer festen Liste und einen kurzen Text. Termine bucht der Code nur aus den Zeiten, die er selbst angeboten hat, und prüft sie vorher noch einmal gegen den Kalender.
* **Lead Texte sind Daten, keine Anweisungen.** Nachricht, Chatverlauf und Formularangaben gehen in eigenen Blöcken an Claude (`<nachricht_lead>` usw.). Spitze Klammern werden ersetzt, damit niemand einen Block schließen und eigene „Systemanweisungen“ einschmuggeln kann. Unsichtbare Zeichen werden entfernt. Der Prompt sagt ausdrücklich, dass nichts darin befolgt wird.
* **Jede Antwort wird vor dem Senden geprüft, im Code und nicht von Claude** (`antwortVerwerfen`). Verworfen wird alles mit anderem Betrag als 5.000 €, Prozentangaben außer „100 %“, fremden Links (erlaubt: thatsit.marketing und die eigene Website des Leads), E-Mail-Adressen, Telefonnummern, anderen Namen aus dem Team, Rabatt, Garantie, verbindlichem Angebot, Begriffen wie Prompt, Anweisungen, Anthropic, Code und Beleidigungen. Höchstens 600 Zeichen. Statt der verworfenen Antwort geht ein fester Text aus `TEXTE` raus, im Backoffice steht der Grund unter „Fehler“.
* **Felder aus Claude werden geprüft**: Einordnung nur aus der Liste, Datum und Uhrzeit nur im festen Format, freie Felder gekürzt.
* **Limits gegen Fluten und Kosten**: mehr als 20 Nachrichten in einer Stunde oder 60 an einem Tag pausieren den Bot in diesem Chat und schicken eine Mail ans Team. Über alle Chats höchstens 1.500 Aufrufe von Claude am Tag (`WHATSAPP_KI_TAGESLIMIT`), danach läuft der Bot nur mit Knöpfen und festen Texten. Nachrichten werden auf 4.000 Zeichen gespeichert, an Claude gehen höchstens 1.200. Sprachnachrichten über 6 MB werden nicht umgewandelt, Medien nur von Servern von Meta geladen.
* **Formular**: Name und Firma gehen in die Vorlage. Mit Links, @, Klammern oder vielen Ziffern wird der Name abgelehnt und die Firma weggelassen. Die Webseite muss wie eine Domain aussehen.
* **Zugänge**: Webhook nur mit gültiger Signatur von Meta, Lead Schnittstelle nur mit `WHATSAPP_LEAD_SCHLUESSEL` (zeitkonstant verglichen), Backoffice nur angemeldet. Fremde Nummern ignoriert der Bot und speichert nichts, „Stopp“ sperrt die Nummer, bis ein Admin sie wieder freischaltet.
* **Was bleibt**: Ein Lead kann seinen eigenen Chat durcheinanderbringen, aber den Bot nichts Falsches oder Verbindliches sagen lassen. Wer im Formular eine fremde Nummer einträgt, löst eine einzige Vorlage aus; dagegen helfen Turnstile, Rate Limit und Dublettenprüfung der Landingpage. Vor dem Start einmal gezielt versuchen, den Bot auszutricksen, und die Ergebnisse im Backoffice ansehen.
