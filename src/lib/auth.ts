import { env } from 'cloudflare:workers';
import type { AstroCookies } from 'astro';
import { eins } from './db';
import type { Nutzer } from './typen';

export const SITZUNG_COOKIE = 'lm_sitzung';
const SITZUNG_STUNDEN = 8;
const ITERATIONEN = 100_000; // Obergrenze für PBKDF2 in Workers

const enc = new TextEncoder();

function zuHex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function vonHex(hex: string) {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function gleich(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(passwort: string, salz: Uint8Array<ArrayBuffer>, iterationen: number) {
  const schluessel = await crypto.subtle.importKey('raw', enc.encode(passwort), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salz, iterations: iterationen },
    schluessel,
    256,
  );
  return zuHex(bits);
}

export async function passwortHash(passwort: string) {
  const salz = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONEN}$${zuHex(salz.buffer)}$${await pbkdf2(passwort, salz, ITERATIONEN)}`;
}

export async function passwortPruefen(passwort: string, gespeichert: string) {
  const [verfahren, iter, salz, hash] = gespeichert.split('$');
  if (verfahren !== 'pbkdf2' || !iter || !salz || !hash) return false;
  return gleich(await pbkdf2(passwort, vonHex(salz), Number(iter)), hash);
}

async function hmac(daten: string) {
  const geheim = env.SESSION_SECRET;
  if (!geheim || geheim.length < 16) throw new Error('SESSION_SECRET fehlt oder ist zu kurz');
  const schluessel = await crypto.subtle.importKey('raw', enc.encode(geheim), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return zuHex(await crypto.subtle.sign('HMAC', schluessel, enc.encode(daten)));
}

/**
 * Signiert kurze Werte. Der Zweck fließt in die Signatur ein, damit etwa ein OAuth state
 * nie als Sitzungscookie gültig ist.
 */
export async function signieren(wert: string, zweck: 'sitzung' | 'oauth' = 'sitzung') {
  return `${wert}.${await hmac(`${zweck}:${wert}`)}`;
}

export async function signaturPruefen(signiert: string, zweck: 'sitzung' | 'oauth' = 'sitzung') {
  const punkt = signiert.lastIndexOf('.');
  if (punkt < 1) return null;
  const wert = signiert.slice(0, punkt);
  return gleich(await hmac(`${zweck}:${wert}`), signiert.slice(punkt + 1)) ? wert : null;
}

export async function sitzungStarten(cookies: AstroCookies, nutzerId: string, sicher: boolean) {
  const ablauf = Date.now() + SITZUNG_STUNDEN * 3600_000;
  cookies.set(SITZUNG_COOKIE, await signieren(`${nutzerId}|${ablauf}`), {
    httpOnly: true,
    secure: sicher,
    sameSite: 'strict',
    path: '/',
    maxAge: SITZUNG_STUNDEN * 3600,
  });
}

export function sitzungBeenden(cookies: AstroCookies) {
  cookies.delete(SITZUNG_COOKIE, { path: '/' });
}

export async function nutzerAusSitzung(cookies: AstroCookies): Promise<Nutzer | null> {
  const roh = cookies.get(SITZUNG_COOKIE)?.value;
  if (!roh) return null;
  const wert = await signaturPruefen(roh).catch(() => null);
  if (!wert) return null;
  const [id, ablauf] = wert.split('|');
  if (!id || Number(ablauf) < Date.now()) return null;
  return eins<Nutzer>('SELECT * FROM nutzer WHERE id = ? AND aktiv = 1', id);
}
