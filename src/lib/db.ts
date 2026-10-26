import { env } from 'cloudflare:workers';

type Wert = string | number | null;

export function db(): D1Database {
  return env.DB;
}

export async function alle<T>(sql: string, ...werte: Wert[]): Promise<T[]> {
  const ergebnis = await db().prepare(sql).bind(...werte).all<T>();
  return ergebnis.results ?? [];
}

export async function eins<T>(sql: string, ...werte: Wert[]): Promise<T | null> {
  return (await db().prepare(sql).bind(...werte).first<T>()) ?? null;
}

export async function ausfuehren(sql: string, ...werte: Wert[]) {
  return db().prepare(sql).bind(...werte).run();
}

export function jetztIso() {
  return new Date().toISOString();
}

/** Zufällige, URL taugliche ID. 16 Byte reichen auch als Geheimnis für Verwaltungslinks. */
export function neueId(bytes = 16) {
  const roh = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(roh, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, Math.ceil(bytes * 1.6));
}
