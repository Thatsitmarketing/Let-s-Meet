import { eins, ausfuehren } from './db';
import { LOGIN_KONTO } from './abfragen';
import type { Konto, WechselAbhaengigkeiten } from './wechsel';

/**
 * Aktives Konto mit echtem Passwort zur Mailadresse. `LOGIN_KONTO` schließt das Büro Konto ohne
 * Passwort (`passwort_hash = '!'`) aus. Es werden nie Konten angelegt, die lokale Rolle bleibt.
 */
export const kontoSuchen: WechselAbhaengigkeiten['kontoSuchen'] = (email) =>
  eins<Konto>(`SELECT id, email, name, rolle FROM nutzer WHERE lower(email) = ? AND aktiv = 1 AND ${LOGIN_KONTO}`, email.trim().toLowerCase());

// Notbehelf, falls die Tabelle wechsel_token noch fehlt (Migration 0018 nicht eingespielt): gilt nur je Worker Instanz.
const imSpeicher = new Map<string, number>();

/** true = erste Verwendung der Token ID (Unix Sekunden `ablauf`), false = schon benutzt. */
export const jtiMerken: WechselAbhaengigkeiten['jtiMerken'] = async (jti, ablauf) => {
  try {
    await ausfuehren('DELETE FROM wechsel_token WHERE ablauf < ?', Math.floor(Date.now() / 1000) - 60);
    const r = await ausfuehren('INSERT OR IGNORE INTO wechsel_token (jti, ablauf) VALUES (?, ?)', jti, ablauf);
    return (r.meta.changes ?? 0) > 0;
  } catch (fehler) {
    console.error('wechsel_token nicht verfügbar, Replay Schutz nur im Speicher (Migration 0018 einspielen)', fehler);
    const jetzt = Math.floor(Date.now() / 1000);
    for (const [k, e] of imSpeicher) if (e < jetzt) imSpeicher.delete(k);
    if (imSpeicher.has(jti)) return false;
    imSpeicher.set(jti, ablauf);
    return true;
  }
};
