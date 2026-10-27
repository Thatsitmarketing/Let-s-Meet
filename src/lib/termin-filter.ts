import type { Nutzer } from './typen';

export type Ansicht = 'bevorstehend' | 'vergangen' | 'storniert';

/** Baut WHERE Bedingung und Parameter für die Terminliste und den CSV Export. */
export function terminFilter(url: URL, nutzer: Nutzer, darfTeam = false) {
  const p = url.searchParams;
  const ansicht = (['bevorstehend', 'vergangen', 'storniert'].includes(p.get('ansicht') ?? '') ? p.get('ansicht') : 'bevorstehend') as Ansicht;
  const team = darfTeam && p.get('wer') === 'team';
  const suche = (p.get('suche') ?? '').trim().slice(0, 100);
  const von = /^\d{4}-\d{2}-\d{2}$/.test(p.get('von') ?? '') ? p.get('von')! : '';
  const bis = /^\d{4}-\d{2}-\d{2}$/.test(p.get('bis') ?? '') ? p.get('bis')! : '';
  const jetzt = new Date().toISOString();

  const bed: string[] = [];
  const werte: (string | number)[] = [];
  if (!team) {
    bed.push('b.nutzer_id = ?');
    werte.push(nutzer.id);
  }
  if (ansicht === 'storniert') bed.push("b.status = 'storniert'");
  else {
    bed.push("b.status = 'bestaetigt'");
    bed.push(ansicht === 'bevorstehend' ? 'b.ende_utc >= ?' : 'b.ende_utc < ?');
    werte.push(jetzt);
  }
  if (suche) {
    bed.push('(b.gast_name LIKE ? OR b.gast_email LIKE ? OR t.titel LIKE ?)');
    const like = `%${suche.replace(/[%_]/g, '')}%`;
    werte.push(like, like, like);
  }
  if (von) {
    bed.push('b.start_utc >= ?');
    werte.push(`${von}T00:00:00.000Z`);
  }
  if (bis) {
    bed.push('b.start_utc <= ?');
    werte.push(`${bis}T23:59:59.999Z`);
  }
  const reihenfolge = ansicht === 'bevorstehend' ? 'ASC' : 'DESC';
  return { ansicht, team, suche, von, bis, where: bed.join(' AND '), werte, reihenfolge };
}
