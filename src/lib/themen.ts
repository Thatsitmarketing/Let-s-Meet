/**
 * Themen der Unterlagen zur Vorbereitung. Die Buchungsseite zeigt nur die Playbooks, die zur
 * Anfrage passen, zum Beispiel aus dem Kontakt Funnel der Homepage („Interesse: Social Media“)
 * oder über den Parameter `?thema=social,website`. Ohne erkennbares Interesse erscheinen alle.
 * Läuft auf dem Server (Zuordnung der Unterlagen) und im Browser (Filter).
 */
export type Thema = 'website' | 'social' | 'recruiting' | 'gastro';

/** Erkennt das Thema einer Unterlage an Titel und Link. Recruiting vor Social, weil beide „Social“ enthalten. */
const UNTERLAGE: [Thema, RegExp][] = [
  ['recruiting', /recruiting/i],
  ['gastro', /gastro/i],
  ['social', /social[\s-]*media/i],
  ['website', /website|webdesign|conversion/i],
];

export function unterlageThema(u: { titel: string; url: string }): Thema | null {
  const text = `${u.titel} ${u.url}`;
  return UNTERLAGE.find(([, muster]) => muster.test(text))?.[0] ?? null;
}

/**
 * Begriffe aus dem Funnel (Webdesign, Social Media, Fotos & Videos, Recruiting), den Varianten
 * der Homepage (webdesign, social, fotos-videos, recruiting) und freie Angaben im Parameter `thema`.
 */
const INTERESSE: [Thema, RegExp][] = [
  ['recruiting', /recruit|personal|bewerb|mitarbeiter/i],
  ['social', /social(?![\s-]*recruit)|foto|video|content|instagram|tiktok|facebook|linkedin/i],
  ['website', /web|homepage|seo|conversion|landing/i],
  ['gastro', /gastro/i],
];

/** Branchen, bei denen zusätzlich das Gastro Playbook passt (aus der Zeile „Unternehmen:“). */
const GASTRO = /gastro|restaurant|caf[eé]|bistro|\bbar\b|hotel|pizzeria|imbiss|kneipe|catering|brauhaus|eisdiele|trattoria|steakhouse|burger/i;

export function themenAusInteresse(interesse: string, unternehmen = ''): Set<Thema> {
  const themen = new Set<Thema>();
  for (const teil of interesse.split(/[,;\n]+/)) {
    for (const [thema, muster] of INTERESSE) if (muster.test(teil)) themen.add(thema);
  }
  if (GASTRO.test(unternehmen)) themen.add('gastro');
  return themen;
}
