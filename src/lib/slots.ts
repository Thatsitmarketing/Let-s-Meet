/**
 * Berechnet freie Startzeiten einer Terminart.
 * Grundlage: Wochenregeln und Tagesausnahmen des Gastgebers, bestehende Buchungen,
 * belegte Zeiten aus Google, Vorlauf, Vorausbuchungsgrenze, Puffer und Tageslimit.
 */
import { alle } from './db';
import { googleBelegt } from './google';
import type { Ausnahme, Nutzer, Regel, Terminart } from './typen';
import { addTage, datumInZone, wochentagVon, zoneZuUtc } from './zeit';

interface Optionen {
  terminart: Terminart;
  nutzer: Nutzer;
  von: Date;
  bis: Date;
  /** Beim Umbuchen zählt die alte Buchung nicht als belegt. */
  ohneBuchung?: string | null;
  jetzt?: Date;
}

export async function freieSlots({ terminart, nutzer, von, bis, ohneBuchung, jetzt = new Date() }: Optionen): Promise<string[]> {
  const tz = nutzer.zeitzone;
  const dauer = terminart.dauer_min * 60_000;
  const frueheste = jetzt.getTime() + terminart.vorlauf_min * 60_000;
  const spaeteste = jetzt.getTime() + terminart.max_tage_voraus * 86_400_000;

  const start = Math.max(von.getTime(), frueheste);
  const ende = Math.min(bis.getTime(), spaeteste);
  if (start >= ende) return [];

  // Einen Tag Rand auf beiden Seiten, weil sich Zonen gegenüber UTC verschieben.
  const ersterTag = addTage(datumInZone(new Date(start), tz), -1);
  const letzterTag = addTage(datumInZone(new Date(ende), tz), 1);

  const [regeln, ausnahmen, buchungen] = await Promise.all([
    alle<Regel>('SELECT wochentag, start_min, ende_min FROM verfuegbarkeit WHERE nutzer_id = ? ORDER BY start_min', nutzer.id),
    alle<Ausnahme>(
      'SELECT id, datum, start_min, ende_min FROM ausnahmen WHERE nutzer_id = ? AND datum BETWEEN ? AND ?',
      nutzer.id,
      ersterTag,
      letzterTag,
    ),
    alle<{ id: string; terminart_id: string; start_utc: string; ende_utc: string }>(
      `SELECT id, terminart_id, start_utc, ende_utc FROM buchungen
       WHERE nutzer_id = ? AND status = 'bestaetigt' AND ende_utc > ? AND start_utc < ?`,
      nutzer.id,
      new Date(start - 86_400_000).toISOString(),
      new Date(ende + 86_400_000).toISOString(),
    ),
  ]);

  const google = await googleBelegt(nutzer, new Date(start - 86_400_000), new Date(ende + 86_400_000));
  const belegt = [
    ...buchungen.filter((b) => b.id !== ohneBuchung).map((b) => ({ start: Date.parse(b.start_utc), ende: Date.parse(b.ende_utc) })),
    ...google,
  ];

  // Anzahl Buchungen dieser Terminart je Gastgebertag für das Tageslimit
  const proTag = new Map<string, number>();
  for (const b of buchungen) {
    if (b.id === ohneBuchung || b.terminart_id !== terminart.id) continue;
    const tag = datumInZone(new Date(b.start_utc), tz);
    proTag.set(tag, (proTag.get(tag) ?? 0) + 1);
  }

  const ausnahmenNachTag = new Map<string, Ausnahme[]>();
  for (const a of ausnahmen) {
    const liste = ausnahmenNachTag.get(a.datum) ?? [];
    liste.push(a);
    ausnahmenNachTag.set(a.datum, liste);
  }

  const vor = terminart.puffer_vor_min * 60_000;
  const nach = terminart.puffer_nach_min * 60_000;
  const raster = Math.max(5, terminart.raster_min || terminart.dauer_min);
  const ergebnis: string[] = [];

  for (let tag = ersterTag; tag <= letzterTag; tag = addTage(tag, 1)) {
    if (terminart.max_pro_tag && (proTag.get(tag) ?? 0) >= terminart.max_pro_tag) continue;

    const abweichung = ausnahmenNachTag.get(tag);
    const fenster: { start_min: number; ende_min: number }[] = abweichung
      ? abweichung.filter((a) => a.start_min !== null && a.ende_min !== null).map((a) => ({ start_min: a.start_min!, ende_min: a.ende_min! }))
      : regeln.filter((r) => r.wochentag === wochentagVon(tag));

    for (const f of fenster) {
      for (let min = f.start_min; min + terminart.dauer_min <= f.ende_min; min += raster) {
        const s = zoneZuUtc(tag, min, tz).getTime();
        const e = s + dauer;
        if (s < start || s > ende) continue;
        const kollision = belegt.some((b) => s - vor < b.ende && e + nach > b.start);
        if (!kollision) ergebnis.push(new Date(s).toISOString());
      }
    }
  }

  return [...new Set(ergebnis)].sort();
}

export async function slotFrei(opts: Omit<Optionen, 'von' | 'bis'> & { startUtc: string }) {
  const s = new Date(opts.startUtc);
  if (Number.isNaN(s.getTime())) return false;
  const slots = await freieSlots({ ...opts, von: new Date(s.getTime() - 60_000), bis: new Date(s.getTime() + 60_000) });
  return slots.includes(s.toISOString());
}
