/**
 * Buchungsablauf im Browser: Monat laden, Tag wählen, Uhrzeit wählen, Formular senden.
 * Zeiten kommen in UTC vom Server und werden in der gewählten Zeitzone angezeigt.
 * Mobil (bis 860px) ist jeder Teil ein eigener Schritt (tag, zeit, daten), die Zurück Geste
 * des Browsers geht einen Schritt zurück.
 */
import { vorabHinweis as vorabHinweisText } from '../lib/herkunft';
import { addTage, datumInZone, teileInZone, wochentagVon, zoneZuUtc } from '../lib/zeit';

interface Konfig {
  terminart: string;
  dauer: number;
  zoneGastgeber: string;
  maxTage: number;
  umbuchen: string | null;
  turnstile: string | null;
  embed: boolean;
  profilUrl: string;
  vorbelegt: { name: string; email: string };
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type Schritt = 'tag' | 'zeit' | 'daten';
const REIHENFOLGE: Schritt[] = ['tag', 'zeit', 'daten'];

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function starteBuchung() {
  const wurzel = $('buchung');
  if (!wurzel) return;
  const k: Konfig = JSON.parse(wurzel.dataset.konfig || '{}');

  const tageEl = $('tage');
  const monatTitel = $('monat-titel');
  const zurueckBtn = $<HTMLButtonElement>('monat-zurueck');
  const vorBtn = $<HTMLButtonElement>('monat-vor');
  const statusEl = $('kal-status');
  const zoneSel = $<HTMLSelectElement>('zone');
  const zeitenEl = $('zeiten');
  const zeitenListe = $('zeiten-liste');
  const tagTitel = $('tag-titel');
  const schrittKal = $('schritt-kalender');
  const schrittForm = $('schritt-formular');
  const form = $<HTMLFormElement>('formular');
  const absenden = $<HTMLButtonElement>('absenden');
  const formFehler = $('formular-fehler');
  const gewaehltText = $('gewaehlt-text');
  const geladenUm = Date.now();
  const mobil = window.matchMedia('(max-width: 860px)');
  // Verlauf nur auf der eigenen Seite, im Widget würde er die einbindende Seite mitnehmen
  const mitVerlauf = !k.embed;
  let schritt: Schritt = 'tag';

  /** Setzt den Schritt für die mobile Ansicht. Auf dem Desktop hat data-schritt keine sichtbare Wirkung. */
  function schrittSetzen(neu: Schritt, verlauf = true) {
    const vorher = schritt;
    schritt = neu;
    wurzel.dataset.schritt = neu;
    if (!mobil.matches || vorher === neu) return;
    if (verlauf && mitVerlauf) {
      // Vorwärts neuer Eintrag, rückwärts den vorhandenen ersetzen, damit die Zurück Geste nicht hin und her springt
      if (REIHENFOLGE.indexOf(neu) > REIHENFOLGE.indexOf(vorher)) history.pushState({ lmSchritt: neu }, '');
      else history.replaceState({ lmSchritt: neu }, '');
    }
    if (!k.embed) wurzel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Vorbelegung aus dem Fragment der Adresse (#name=...&email=...&telefon=...&nachricht=...&quelle=...),
  // zum Beispiel vom Kontakt-Funnel der Homepage. Das Fragment erreicht nie den Server und
  // verschwindet direkt wieder aus der Adresszeile.
  const fragment = new URLSearchParams(location.hash.slice(1));
  const ausFragment = (name: string, max: number) => (fragment.get(name) ?? '').trim().slice(0, max);
  const vorab = {
    name: ausFragment('name', 120),
    email: ausFragment('email', 180),
    telefon: ausFragment('telefon', 40),
    nachricht: ausFragment('nachricht', 2000),
    quelle: ausFragment('quelle', 120),
  };
  if (location.hash && Object.values(vorab).some(Boolean)) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  const vorabHinweis = document.getElementById('vorab-hinweis');

  // Bis 1180px (Infos über dem Kalender): lange Beschreibung auf drei Zeilen kürzen, damit der Kalender ohne viel Scrollen sichtbar ist.
  // Gekürzt wird nur, wenn mindestens zwei Zeilen wegfallen würden, sonst lohnt sich der Knopf nicht.
  const info = wurzel.querySelector<HTMLElement>('.info');
  const beschreibung = document.getElementById('beschreibung');
  const mehrBtn = document.getElementById('mehr-zeigen');
  if (info && beschreibung && mehrBtn) {
    const pruefenKurz = () => {
      if (info.classList.contains('offen')) return;
      info.classList.remove('kurz');
      const zeile = parseFloat(getComputedStyle(beschreibung).lineHeight) || 22;
      info.classList.toggle('kurz', beschreibung.scrollHeight > zeile * 5);
    };
    pruefenKurz();
    window.matchMedia('(max-width: 1180px)').addEventListener('change', pruefenKurz);
    mehrBtn.addEventListener('click', () => {
      const offen = info.classList.toggle('offen');
      mehrBtn.setAttribute('aria-expanded', String(offen));
      mehrBtn.querySelector('.mehr-text')!.textContent = offen ? 'Weniger anzeigen' : 'Mehr anzeigen';
    });
  }

  // Zeitzone: Browserzone als Standard, Liste aller IANA Zonen
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || k.zoneGastgeber;
  let zone = browserZone;
  const zonen: string[] = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [browserZone, k.zoneGastgeber, 'UTC'];
  const oben = [...new Set([browserZone, 'Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'Europe/London', 'UTC'])];
  const optionen = [...oben, ...zonen.filter((z) => !oben.includes(z))];
  zoneSel.innerHTML = optionen.map((z) => `<option value="${z}">${zonenLabel(z)}</option>`).join('');
  zoneSel.value = zone;

  const heute = datumInZone(new Date(), zone);
  let [jahr, monat] = heute.split('-').map(Number);
  let slotsNachTag = new Map<string, string[]>();
  let gewaehlterTag: string | null = null;
  let gewaehlterSlot: string | null = null;
  let anfrageNr = 0;
  let autoWeiter = true;
  // Beim ersten Laden direkt den ersten freien Tag öffnen, damit die Zeiten sofort sichtbar sind
  let autoTag = true;
  let turnstileId: string | null = null;

  const grenzeMonat = (() => {
    const g = datumInZone(new Date(Date.now() + k.maxTage * 86_400_000), zone).split('-').map(Number);
    return g[0] * 12 + g[1];
  })();
  const startMonat = jahr * 12 + monat;

  function zonenLabel(z: string) {
    try {
      const t = teileInZone(new Date(), z);
      const zeit = `${String(t.stunde).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
      return `${z.replace(/_/g, ' ')} (${zeit})`;
    } catch {
      return z;
    }
  }

  const fmtTag = (datum: string) =>
    new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${datum}T12:00:00Z`));
  const fmtZeit = (iso: string) => new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(new Date(iso));
  const fmtVoll = (iso: string) => {
    const ende = new Date(Date.parse(iso) + k.dauer * 60_000).toISOString();
    return `${fmtTag(datumInZone(new Date(iso), zone))}, ${fmtZeit(iso)} bis ${fmtZeit(ende)} Uhr`;
  };

  async function monatLaden() {
    const nr = ++anfrageNr;
    const erster = `${jahr}-${String(monat).padStart(2, '0')}-01`;
    const naechster = monat === 12 ? `${jahr + 1}-01-01` : `${jahr}-${String(monat + 1).padStart(2, '0')}-01`;
    monatTitel.textContent = `${MONATE[monat - 1]} ${jahr}`;
    zurueckBtn.disabled = jahr * 12 + monat <= startMonat;
    vorBtn.disabled = jahr * 12 + monat >= grenzeMonat;
    tageEl.dataset.laedt = 'true';
    statusEl.textContent = 'Freie Termine werden geladen';
    zeichneTage(erster, naechster);

    const von = zoneZuUtc(erster, 0, zone).toISOString();
    const bis = zoneZuUtc(naechster, 0, zone).toISOString();
    const p = new URLSearchParams({ terminart: k.terminart, von, bis });
    if (k.umbuchen) p.set('umbuchen', k.umbuchen);
    try {
      const res = await fetch(`/api/slots?${p}`);
      if (!res.ok) throw new Error(String(res.status));
      const { slots } = (await res.json()) as { slots: string[] };
      if (nr !== anfrageNr) return;
      slotsNachTag = new Map();
      for (const s of slots) {
        const tag = datumInZone(new Date(s), zone);
        if (tag < erster || tag >= naechster) continue;
        const liste = slotsNachTag.get(tag) ?? [];
        liste.push(s);
        slotsNachTag.set(tag, liste);
      }
      tageEl.dataset.laedt = 'false';
      const anzahl = slotsNachTag.size;
      // Ist der aktuelle Monat ausgebucht, einmal automatisch weiterblättern
      if (anzahl === 0 && autoWeiter && !vorBtn.disabled) {
        autoWeiter = false;
        blaettern(1);
        return;
      }
      autoWeiter = false;
      statusEl.textContent = anzahl === 0 ? 'In diesem Monat ist nichts mehr frei.' : `${anzahl} ${anzahl === 1 ? 'Tag' : 'Tage'} mit freien Terminen`;
      zeichneTage(erster, naechster);
      if (gewaehlterTag && slotsNachTag.has(gewaehlterTag)) zeigeZeiten(gewaehlterTag);
      else if (autoTag && anzahl > 0 && !mobil.matches) {
        autoTag = false;
        zeigeZeiten([...slotsNachTag.keys()].sort()[0]!);
      } else {
        gewaehlterTag = null;
        zeitenEl.hidden = true;
        // Mobil gibt es ohne Tag keine Zeiten zu zeigen
        if (schritt === 'zeit') schrittSetzen('tag', false);
      }
    } catch {
      if (nr !== anfrageNr) return;
      tageEl.dataset.laedt = 'false';
      statusEl.textContent = 'Die freien Termine konnten nicht geladen werden. Bitte lade die Seite neu.';
    }
  }

  function zeichneTage(erster: string, naechster: string) {
    const versatz = (wochentagVon(erster) + 6) % 7; // Montag zuerst
    const heuteZone = datumInZone(new Date(), zone);
    const teile: string[] = [];
    for (let i = 0; i < versatz; i++) teile.push('<span aria-hidden="true"></span>');
    for (let tag = erster; tag < naechster; tag = addTage(tag, 1)) {
      const frei = slotsNachTag.has(tag);
      const nummer = Number(tag.slice(8));
      const klassen = ['tag', frei ? 'frei' : '', tag === heuteZone ? 'heute' : ''].filter(Boolean).join(' ');
      const label = `${fmtTag(tag)}${frei ? ', freie Termine' : ', nicht verfügbar'}`;
      teile.push(
        `<button type="button" class="${klassen}" data-tag="${tag}" aria-label="${label}" ${frei ? `aria-pressed="${tag === gewaehlterTag}"` : 'disabled'}>${nummer}</button>`,
      );
    }
    tageEl.innerHTML = teile.join('');
  }

  function zeigeZeiten(tag: string) {
    gewaehlterTag = tag;
    tageEl.querySelectorAll<HTMLButtonElement>('.tag.frei').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tag === tag)));
    tagTitel.textContent = fmtTag(tag);
    const slots = slotsNachTag.get(tag) ?? [];
    zeitenListe.innerHTML = slots.length
      ? slots
          .map((s) => `<li><button type="button" class="zeit" data-slot="${s}" aria-pressed="false">${fmtZeit(s)}</button></li>`)
          .join('')
      : '<li class="leer">Keine freien Zeiten.</li>';
    zeitenEl.hidden = false;
  }

  function slotWaehlen(knopf: HTMLButtonElement) {
    zeitenListe.querySelectorAll('.weiter').forEach((w) => w.remove());
    zeitenListe.querySelectorAll<HTMLButtonElement>('.zeit').forEach((z) => z.setAttribute('aria-pressed', 'false'));
    knopf.setAttribute('aria-pressed', 'true');
    gewaehlterSlot = knopf.dataset.slot!;
    // Mobil ist der Tipp auf die Uhrzeit schon die Entscheidung, ohne extra Weiter Knopf
    if (mobil.matches) return zumFormular();
    const weiter = document.createElement('button');
    weiter.type = 'button';
    weiter.className = 'knopf knopf--orange weiter';
    weiter.textContent = 'Weiter';
    weiter.setAttribute('aria-label', `Weiter mit ${fmtVoll(gewaehlterSlot)}`);
    weiter.addEventListener('click', () => zumFormular());
    knopf.after(weiter);
    weiter.focus();
  }

  function auswahlAnzeigen(an: boolean) {
    const zeile = document.getElementById('auswahl-zeile');
    const zoneZeile = document.getElementById('zone-zeile');
    if (zeile && zoneZeile) {
      zeile.hidden = !an;
      zoneZeile.hidden = !an;
      if (an && gewaehlterSlot) {
        $('auswahl-text').textContent = fmtVoll(gewaehlterSlot);
        $('zone-text').textContent = zone.replace(/_/g, ' ');
      }
    }
  }

  function zumFormular(verlauf = true) {
    if (!gewaehlterSlot) return;
    schrittKal.hidden = true;
    schrittForm.hidden = false;
    gewaehltText.textContent = `${fmtVoll(gewaehlterSlot)} (${zone.replace(/_/g, ' ')})`;
    $('zf-wann').textContent = fmtVoll(gewaehlterSlot);
    $('zf-zone').textContent = `Zeitzone ${zone.replace(/_/g, ' ')}`;
    schrittSetzen('daten', verlauf);
    auswahlAnzeigen(true);
    turnstileLaden();
    const name = $<HTMLInputElement>('f-name');
    if (!name.value && (k.vorbelegt.name || vorab.name)) name.value = k.vorbelegt.name || vorab.name;
    const email = $<HTMLInputElement>('f-email');
    if (!email.value && (k.vorbelegt.email || vorab.email)) email.value = k.vorbelegt.email || vorab.email;
    const telefon = document.getElementById('f-telefon') as HTMLInputElement | null;
    if (telefon && !telefon.value && vorab.telefon) telefon.value = vorab.telefon;
    const nachricht = $<HTMLTextAreaElement>('f-nachricht');
    if (!nachricht.value && vorab.nachricht) nachricht.value = vorab.nachricht;
    if (vorabHinweis) {
      vorabHinweis.hidden = !(vorab.name || vorab.email);
      // Text passend zur Herkunft, z. B. "aus der Anfrage zum Gastro Marketing Playbook"
      const text = vorabHinweis.querySelector('[data-vorab-text]');
      if (text && vorab.quelle) text.textContent = vorabHinweisText(vorab.quelle);
    }
    $('titel-formular').setAttribute('tabindex', '-1');
    $('titel-formular').focus({ preventScroll: mobil.matches });
    if (!k.embed && !mobil.matches) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Zurück aus dem Formular: Desktop zum Kalender mit Zeiten, mobil zu den Zeiten des gewählten Tages. */
  function zumKalender(verlauf = true) {
    schrittForm.hidden = true;
    schrittKal.hidden = false;
    auswahlAnzeigen(false);
    schrittSetzen(mobil.matches && gewaehlterTag ? 'zeit' : 'tag', verlauf);
    const aktiv = zeitenListe.querySelector<HTMLButtonElement>('.zeit[aria-pressed="true"]');
    (aktiv ?? tageEl.querySelector<HTMLButtonElement>('.tag.frei'))?.focus({ preventScroll: mobil.matches });
  }

  /** Mobil vom Zeitschritt zurück zum Kalender */
  function zumTag(verlauf = true) {
    schrittForm.hidden = true;
    schrittKal.hidden = false;
    auswahlAnzeigen(false);
    schrittSetzen('tag', verlauf);
    tageEl.querySelector<HTMLButtonElement>('.tag[aria-pressed="true"]')?.focus({ preventScroll: true });
  }

  function turnstileLaden() {
    if (!k.turnstile || turnstileId) return;
    const ziel = document.getElementById('turnstile-feld');
    if (!ziel) return;
    // Prüfen auf render, nicht nur auf window.turnstile: ein Element mit der ID turnstile wäre sonst
    // als window.turnstile sichtbar und das Skript würde nie geladen
    const geladen = () => typeof window.turnstile?.render === 'function';
    const rendern = () => {
      const ts = window.turnstile;
      if (!ts || !geladen() || turnstileId) return;
      // interaction-only: das Widget bleibt unsichtbar und nimmt keinen Platz ein, solange Cloudflare keine Rückfrage braucht
      const zeigen = () => ziel.classList.add('sichtbar');
      turnstileId = ts.render(ziel, {
        sitekey: k.turnstile,
        language: 'de',
        theme: 'light',
        appearance: 'interaction-only',
        'before-interactive-callback': zeigen,
        'unsupported-callback': zeigen,
        'error-callback': () => {
          zeigen();
          return false;
        },
      });
    };
    if (geladen()) return rendern();
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = rendern;
    document.head.appendChild(s);
  }

  function blaettern(richtung: number) {
    monat += richtung;
    if (monat > 12) { monat = 1; jahr++; }
    if (monat < 1) { monat = 12; jahr--; }
    zeitenEl.hidden = true;
    gewaehlterTag = null;
    monatLaden();
  }

  function fehlerSetzen(felder: Record<string, string>) {
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    form.querySelectorAll('.fehlertext').forEach((el) => (el.textContent = ''));
    let erstes: HTMLElement | null = null;
    for (const [feld, text] of Object.entries(felder)) {
      const ausgabe = document.getElementById(`fehler-${feld}`);
      if (ausgabe) ausgabe.textContent = text;
      const eingabe = feld.startsWith('frage_')
        ? document.getElementById(`f-frage-${feld.slice(6)}`)
        : document.getElementById(`f-${feld}`);
      eingabe?.setAttribute('aria-invalid', 'true');
      erstes ??= eingabe;
    }
    erstes?.focus();
  }

  function pruefen() {
    const felder: Record<string, string> = {};
    const name = $<HTMLInputElement>('f-name').value.trim();
    const email = $<HTMLInputElement>('f-email').value.trim();
    if (name.length < 2) felder.name = 'Bitte gib deinen Namen an.';
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) felder.email = 'Bitte prüf deine E Mail Adresse.';
    const tel = document.getElementById('f-telefon') as HTMLInputElement | null;
    const telOk = (t: string) => /^[0-9+()\/\s.-]{5,40}$/.test(t) && t.replace(/\D/g, '').length >= 4;
    if (tel?.required && !telOk(tel.value.trim())) felder.telefon = 'Bitte gib eine Telefonnummer an, unter der wir dich erreichen.';
    else if (tel && tel.value.trim() && !telOk(tel.value.trim())) felder.telefon = 'Bitte prüf die Telefonnummer.';
    form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-frage]').forEach((f) => {
      if (f.required && !f.value.trim()) felder[`frage_${f.dataset.frage}`] = 'Bitte füll dieses Feld aus.';
    });
    if (!$<HTMLInputElement>('f-datenschutz').checked) felder.datenschutz = 'Bitte bestätige die Datenschutzhinweise.';
    return felder;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formFehler.hidden = true;
    const felder = pruefen();
    fehlerSetzen(felder);
    if (Object.keys(felder).length) return;

    const antworten: Record<string, string> = {};
    form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-frage]').forEach((f) => (antworten[f.dataset.frage!] = f.value));
    const turnstileToken = (form.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | null)?.value ?? '';
    if (k.turnstile && !turnstileToken) {
      document.getElementById('turnstile-feld')?.classList.add('sichtbar');
      formFehler.textContent = 'Die Sicherheitsprüfung läuft noch. Bitte warte einen Moment und tipp dann noch einmal auf „Termin buchen“.';
      formFehler.hidden = false;
      return;
    }
    let quelle = '';
    try {
      quelle = vorab.quelle || (k.embed ? document.referrer || '' : '');
    } catch {
      quelle = '';
    }

    absenden.dataset.laedt = 'true';
    absenden.disabled = true;
    try {
      const res = await fetch('/api/buchen', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          terminart: k.terminart,
          start: gewaehlterSlot,
          name: $<HTMLInputElement>('f-name').value,
          email: $<HTMLInputElement>('f-email').value,
          telefon: (document.getElementById('f-telefon') as HTMLInputElement | null)?.value ?? '',
          nachricht: $<HTMLTextAreaElement>('f-nachricht').value,
          zeitzone: zone,
          antworten,
          datenschutz: $<HTMLInputElement>('f-datenschutz').checked,
          website: $<HTMLInputElement>('f-website').value,
          ts: geladenUm,
          turnstile: turnstileToken,
          umbuchen: k.umbuchen,
          quelle,
        }),
      });
      const daten = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string | null; weiterleitung?: string | null; fehler?: string; felder?: Record<string, string>; slotWeg?: boolean };
      if (res.ok && daten.ok) {
        if (k.embed && daten.id) {
          window.parent?.postMessage({ typ: 'letsmeet:gebucht', buchung: daten.id, start: gewaehlterSlot }, '*');
        }
        if (daten.weiterleitung) {
          (k.embed ? window.top ?? window : window).location.href = daten.weiterleitung;
          return;
        }
        window.location.href = daten.id ? `/termin/${daten.id}?neu=1${k.embed ? '&embed=1' : ''}` : k.profilUrl;
        return;
      }
      if (res.status === 422 && daten.felder) fehlerSetzen(daten.felder);
      else {
        formFehler.textContent = daten.fehler || 'Die Buchung hat nicht geklappt. Bitte versuch es noch einmal.';
        formFehler.hidden = false;
        if (daten.slotWeg) {
          gewaehlterSlot = null;
          setTimeout(() => {
            zumKalender();
            monatLaden();
          }, 2500);
        }
      }
      if (turnstileId && window.turnstile) window.turnstile.reset(turnstileId);
    } catch {
      formFehler.textContent = 'Keine Verbindung. Bitte prüf dein Internet und versuch es noch einmal. Alternativ erreichst du uns unter 0209 36660644.';
      formFehler.hidden = false;
    } finally {
      absenden.dataset.laedt = 'false';
      absenden.disabled = false;
    }
  });

  tageEl.addEventListener('click', (e) => {
    const knopf = (e.target as HTMLElement).closest<HTMLButtonElement>('.tag.frei');
    if (!knopf?.dataset.tag) return;
    zeigeZeiten(knopf.dataset.tag);
    if (mobil.matches) {
      schrittSetzen('zeit');
      tagTitel.setAttribute('tabindex', '-1');
      tagTitel.focus({ preventScroll: true });
    }
  });
  zeitenListe.addEventListener('click', (e) => {
    const knopf = (e.target as HTMLElement).closest<HTMLButtonElement>('.zeit');
    if (knopf) slotWaehlen(knopf);
  });
  zurueckBtn.addEventListener('click', () => blaettern(-1));
  vorBtn.addEventListener('click', () => blaettern(1));
  zoneSel.addEventListener('change', () => {
    zone = zoneSel.value;
    gewaehlterSlot = null;
    monatLaden();
  });
  $('zurueck-kalender').addEventListener('click', () => zumKalender());
  $('zurueck-tag').addEventListener('click', () => zumTag());

  // Zurück Geste des Browsers: einen Schritt zurück statt die Seite zu verlassen
  if (mitVerlauf) {
    history.replaceState({ ...(history.state ?? {}), lmSchritt: 'tag' }, '');
    window.addEventListener('popstate', (e) => {
      const ziel = (e.state?.lmSchritt as Schritt | undefined) ?? 'tag';
      if (ziel === schritt) return;
      if (ziel === 'daten' && gewaehlterSlot) zumFormular(false);
      else if (ziel === 'zeit' && gewaehlterTag) zumKalender(false);
      else zumTag(false);
    });
  }
  // Wechsel von schmal auf breit (Tablet drehen): im Kalender stehen Tag und Zeiten wieder nebeneinander
  mobil.addEventListener('change', () => {
    if (!mobil.matches && schritt === 'zeit') schrittSetzen('tag', false);
  });

  monatLaden();
}
