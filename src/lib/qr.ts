/**
 * QR-Codes für die Links der Terminarten. Kodierung über `uqr`, ausgegeben als SVG (Vektor, für den Druck)
 * oder als PNG (Bild). Das PNG baut der Worker selbst: Graustufen, 8 Bit, komprimiert mit `CompressionStream`,
 * ohne Bildbibliothek und ohne Node APIs.
 */
import { encode } from 'uqr';
import { env } from 'cloudflare:workers';

/** Ruhezone um den Code in Modulen, laut Norm mindestens 4. */
const RAND = 4;
/** Fehlerkorrektur M: 15 Prozent dürfen fehlen, robust genug für Druck, Code bleibt klein. */
const KORREKTUR = 'M' as const;
const DUNKEL = '#0E0E0E';
const DUNKEL_GRAU = 0x0e;

/**
 * Öffentliche Adresse einer Terminart für QR-Codes. Immer die feste Domain aus `SITE_URL`,
 * damit ein gedruckter Code nicht auf eine Vorschau oder localhost zeigt.
 */
export function qrLink(slug: string, anfrage: URL): string {
  const basis = (env.SITE_URL || anfrage.origin).replace(/\/$/, '');
  return `${basis}/${slug}`;
}

function matrix(text: string) {
  return encode(text, { ecc: KORREKTUR, border: 0 });
}

/** SVG mit einem Pfad, waagerechte Läufe zusammengefasst, Ruhezone inklusive. */
export function qrSvg(text: string, titel?: string): string {
  const qr = matrix(text);
  const groesse = qr.size + RAND * 2;
  let pfad = '';
  qr.data.forEach((zeile, y) => {
    let x = 0;
    while (x < qr.size) {
      if (!zeile[x]) { x++; continue; }
      const start = x;
      while (x < qr.size && zeile[x]) x++;
      pfad += `M${start + RAND} ${y + RAND}h${x - start}v1h-${x - start}z`;
    }
  });
  const name = titel ? `<title>${titel.replace(/[<>&"]/g, '')}</title>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${groesse} ${groesse}" width="${groesse * 10}" height="${groesse * 10}" shape-rendering="crispEdges">` +
    `${name}<rect width="${groesse}" height="${groesse}" fill="#FFFFFF"/><path fill="${DUNKEL}" d="${pfad}"/></svg>`
  );
}

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(daten: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < daten.length; i++) c = CRC_TABELLE[(c ^ daten[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function block(typ: string, inhalt: Uint8Array): Uint8Array {
  const aus = new Uint8Array(12 + inhalt.length);
  const sicht = new DataView(aus.buffer);
  sicht.setUint32(0, inhalt.length);
  for (let i = 0; i < 4; i++) aus[4 + i] = typ.charCodeAt(i);
  aus.set(inhalt, 8);
  sicht.setUint32(8 + inhalt.length, crc32(aus.subarray(4, 8 + inhalt.length)));
  return aus;
}

async function zlib(daten: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const strom = new Blob([daten]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(strom).arrayBuffer());
}

/** PNG mit etwa `zielPixel` Kantenlänge, jedes Modul gleich viele Pixel breit (keine Unschärfe). */
export async function qrPng(text: string, zielPixel = 1200): Promise<Uint8Array<ArrayBuffer>> {
  const qr = matrix(text);
  const module = qr.size + RAND * 2;
  const faktor = Math.max(1, Math.floor(zielPixel / module));
  const kante = module * faktor;

  // Rohdaten: je Zeile ein Filterbyte (0) und ein Byte Grauwert pro Pixel
  const zeilenLaenge = kante + 1;
  const roh = new Uint8Array(zeilenLaenge * kante).fill(0xff);
  for (let y = 0; y < kante; y++) roh[y * zeilenLaenge] = 0;
  for (let my = 0; my < qr.size; my++) {
    for (let mx = 0; mx < qr.size; mx++) {
      if (!qr.data[my][mx]) continue;
      const px = (mx + RAND) * faktor;
      for (let dy = 0; dy < faktor; dy++) {
        const start = ((my + RAND) * faktor + dy) * zeilenLaenge + 1 + px;
        roh.fill(DUNKEL_GRAU, start, start + faktor);
      }
    }
  }

  const kopf = new Uint8Array(13);
  const k = new DataView(kopf.buffer);
  k.setUint32(0, kante);
  k.setUint32(4, kante);
  kopf[8] = 8; // Bittiefe
  kopf[9] = 0; // Graustufen
  const teile = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    block('IHDR', kopf),
    block('IDAT', await zlib(roh)),
    block('IEND', new Uint8Array(0)),
  ];
  const gesamt = new Uint8Array(teile.reduce((s, t) => s + t.length, 0));
  let pos = 0;
  for (const t of teile) { gesamt.set(t, pos); pos += t.length; }
  return gesamt;
}
