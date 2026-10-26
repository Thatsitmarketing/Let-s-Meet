import { alle, ausfuehren, jetztIso, neueId } from './db';
import { ganzzahl, slugify, trimmen, urlGueltig } from './eingabe';
import { FARBEN, type Frage, type OrtTyp, type Terminart } from './typen';

const ORT_TYPEN: OrtTyp[] = ['google_meet', 'telefon_wir', 'telefon_gast', 'vor_ort', 'link'];

export type TerminartWerte = Omit<Terminart, 'id' | 'nutzer_id' | 'erstellt_am' | 'aktualisiert_am' | 'reihenfolge'>;

export const STANDARD: TerminartWerte = {
  slug: '',
  titel: '',
  beschreibung: '',
  dauer_min: 30,
  farbe: '#DC9832',
  ort_typ: 'google_meet',
  ort_wert: '',
  puffer_vor_min: 0,
  puffer_nach_min: 0,
  vorlauf_min: 240,
  max_tage_voraus: 60,
  raster_min: 30,
  max_pro_tag: null,
  fragen: '[]',
  erinnerung_std: 24,
  bestaetigung_text: '',
  weiterleitung_url: '',
  aktiv: 1,
  geheim: 0,
};

export async function terminartAusFormular(form: FormData, nutzerId: string, eigeneId?: string) {
  const fehler: Record<string, string> = {};
  const titel = trimmen(form.get('titel'), 120);
  const slug = slugify(trimmen(form.get('slug'), 60) || titel);
  const ortTyp = ORT_TYPEN.includes(form.get('ort_typ') as OrtTyp) ? (form.get('ort_typ') as OrtTyp) : 'google_meet';
  const ortWert = trimmen(form.get('ort_wert'), 300);
  const farbe = FARBEN.some((f) => f.wert === form.get('farbe')) ? String(form.get('farbe')) : '#DC9832';
  const weiterleitung = trimmen(form.get('weiterleitung_url'), 500);
  const maxProTag = trimmen(form.get('max_pro_tag'), 4);

  let fragen: Frage[] = [];
  try {
    const roh = JSON.parse(String(form.get('fragen') || '[]'));
    if (Array.isArray(roh)) {
      fragen = roh
        .slice(0, 10)
        .map((f) => ({
          id: slugify(String(f.id || '')) || neueId(4),
          label: trimmen(f.label, 200),
          typ: ['text', 'textarea', 'telefon'].includes(f.typ) ? f.typ : 'text',
          pflicht: Boolean(f.pflicht),
        }))
        .filter((f) => f.label.length > 0);
    }
  } catch {
    fehler.fragen = 'Die Fragen konnten nicht gelesen werden.';
  }

  const werte: TerminartWerte = {
    titel,
    slug,
    beschreibung: trimmen(form.get('beschreibung'), 3000),
    dauer_min: ganzzahl(form.get('dauer_min'), 5, 480, 30),
    farbe,
    ort_typ: ortTyp,
    ort_wert: ortWert,
    puffer_vor_min: ganzzahl(form.get('puffer_vor_min'), 0, 240, 0),
    puffer_nach_min: ganzzahl(form.get('puffer_nach_min'), 0, 240, 0),
    vorlauf_min: ganzzahl(form.get('vorlauf_std'), 0, 24 * 30, 4) * 60,
    max_tage_voraus: ganzzahl(form.get('max_tage_voraus'), 1, 365, 60),
    raster_min: ganzzahl(form.get('raster_min'), 5, 240, 30),
    max_pro_tag: maxProTag ? ganzzahl(maxProTag, 1, 50, 1) : null,
    fragen: JSON.stringify(fragen),
    erinnerung_std: ganzzahl(form.get('erinnerung_std'), 0, 168, 24),
    bestaetigung_text: trimmen(form.get('bestaetigung_text'), 2000),
    weiterleitung_url: weiterleitung,
    aktiv: form.get('aktiv') ? 1 : 0,
    geheim: form.get('geheim') ? 1 : 0,
  };

  if (titel.length < 2) fehler.titel = 'Bitte gib einen Titel an.';
  if (slug.length < 2) fehler.slug = 'Bitte mindestens zwei Zeichen.';
  else {
    const vorhanden = await alle<{ id: string }>('SELECT id FROM terminarten WHERE nutzer_id = ? AND slug = ?', nutzerId, slug);
    if (vorhanden.some((v) => v.id !== eigeneId)) fehler.slug = 'Diese Adresse nutzt du schon für eine andere Terminart.';
  }
  if (ortTyp === 'telefon_gast' && !ortWert) fehler.ort_wert = 'Bitte gib die Nummer an, unter der man euch erreicht.';
  if (ortTyp === 'vor_ort' && !ortWert) fehler.ort_wert = 'Bitte gib die Adresse an.';
  if (ortTyp === 'link' && !urlGueltig(ortWert)) fehler.ort_wert = 'Bitte gib einen vollständigen Link an, beginnend mit https://';
  if (weiterleitung && !urlGueltig(weiterleitung)) fehler.weiterleitung_url = 'Bitte gib einen vollständigen Link an, beginnend mit https://';

  return { werte, fehler };
}

export async function terminartSpeichern(w: TerminartWerte, nutzerId: string, id?: string) {
  const jetzt = jetztIso();
  const felder = [
    w.slug, w.titel, w.beschreibung || null, w.dauer_min, w.farbe, w.ort_typ, w.ort_wert || null, w.puffer_vor_min, w.puffer_nach_min,
    w.vorlauf_min, w.max_tage_voraus, w.raster_min, w.max_pro_tag, w.fragen, w.erinnerung_std, w.bestaetigung_text || null,
    w.weiterleitung_url || null, w.aktiv, w.geheim,
  ] as const;
  if (id) {
    await ausfuehren(
      `UPDATE terminarten SET slug = ?, titel = ?, beschreibung = ?, dauer_min = ?, farbe = ?, ort_typ = ?, ort_wert = ?, puffer_vor_min = ?,
        puffer_nach_min = ?, vorlauf_min = ?, max_tage_voraus = ?, raster_min = ?, max_pro_tag = ?, fragen = ?, erinnerung_std = ?,
        bestaetigung_text = ?, weiterleitung_url = ?, aktiv = ?, geheim = ?, aktualisiert_am = ?
       WHERE id = ? AND nutzer_id = ?`,
      ...felder, jetzt, id, nutzerId,
    );
    return id;
  }
  const neu = neueId();
  await ausfuehren(
    `INSERT INTO terminarten (slug, titel, beschreibung, dauer_min, farbe, ort_typ, ort_wert, puffer_vor_min, puffer_nach_min, vorlauf_min,
      max_tage_voraus, raster_min, max_pro_tag, fragen, erinnerung_std, bestaetigung_text, weiterleitung_url, aktiv, geheim,
      erstellt_am, aktualisiert_am, id, nutzer_id, reihenfolge)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(reihenfolge), 0) + 1 FROM terminarten WHERE nutzer_id = ?))`,
    ...felder, jetzt, jetzt, neu, nutzerId, nutzerId,
  );
  return neu;
}
