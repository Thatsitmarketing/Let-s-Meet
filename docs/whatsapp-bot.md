# WhatsApp Bot: Einrichtung

Der Bot schreibt Leads der Landingpage „Kostenloser Website-Entwurf“ an, die im Formular den Haken für WhatsApp gesetzt haben, stellt die Settingfragen und bucht das Strategiegespräch mit Tim direkt in Let's Meet (Google Meet). Code: `src/lib/whatsapp/`, Schnittstellen `/api/whatsapp/lead` und `/api/whatsapp/webhook`, Übersicht im Backoffice unter **WhatsApp Bot**.

Präsentation zum Vorstellen im Team: `docs/praesentation/WhatsApp-Setting-Bot.pdf` (15 Folien, 16:9, mit dem Chat im Wortlaut aus `TEXTE`). Quelle ist `docs/praesentation/whatsapp-bot.html`, gerendert mit Playwright als PDF im Format 1920 × 1080; bei Änderungen am Ablauf beide nachziehen.

## 1. Firmennummer mit der Cloud API verbinden (Coexistence)

1. Meta Business Suite öffnen, unter Einstellungen das Unternehmen prüfen lassen (Unternehmensverifizierung). Ohne sie gilt die Grenze von 250 neuen Kontakten pro Tag, das reicht für den Start.
2. developers.facebook.com, „App erstellen“, Typ **Business**, Anwendungsfall **WhatsApp**. Die App mit dem Business Portfolio von That's it. Marketing verknüpfen.
3. In der App unter WhatsApp, „Erste Schritte“, **Bestehende WhatsApp Business App Nummer verbinden** wählen (Coexistence). Auf dem Firmenhandy in der WhatsApp Business App den QR Code scannen und den Chatverlauf übernehmen. Die Nummer bleibt in der App nutzbar, das Team kann weiter normal schreiben.
4. Wichtig für Coexistence: die WhatsApp Business App mindestens alle 14 Tage einmal öffnen, sonst trennt Meta die Verbindung.
5. Unter WhatsApp, API Setup die **Phone number ID** notieren (nicht die Telefonnummer selbst).

## 2. Dauerhaften Zugangsschlüssel anlegen

1. Business Einstellungen, Nutzer, **Systemnutzer** anlegen (Rolle Admin), der App und dem WhatsApp Konto zuweisen.
2. „Token generieren“, App auswählen, Ablauf **Nie**, Berechtigungen `whatsapp_business_messaging` und `whatsapp_business_management`.
3. Unter App Einstellungen, Allgemein das **App Secret** anzeigen und notieren.

## 3. Vorlagen einreichen

WhatsApp Manager, Nachrichtenvorlagen, „Vorlage erstellen“. Kategorie **Marketing**, Sprache **Deutsch (de)**. Name und Text genau so übernehmen, Variablen als `{{1}}`, `{{2}}`. Knöpfe als **Schnellantwort** in genau dieser Reihenfolge.

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
* Budget „Kommt drauf an“ oder „Eher zu viel“: Einwandbehandlung über Claude nach dem Setting Skript, höchstens zwei Anläufe. Klares Nein danach: höfliche Verabschiedung. Weiter unsicher: Termin wird trotzdem angeboten.
* Das Team schreibt aus der App in den Chat: der Bot pausiert dort. Im Backoffice lässt er sich wieder einschalten.
* „Stopp“ meldet ab, die Nummer wird nie wieder angeschrieben.
* Fremde Nummern (normale Kundenchats auf der Firmennummer) ignoriert der Bot komplett und speichert nichts.
* Am Vortag eine Erinnerung per WhatsApp, zusätzlich zu den Mails aus den Arbeitsabläufen.
