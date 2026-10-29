#!/usr/bin/env python3
"""
Tauscht die QR-Codes in einem Playbook gegen den Link zum passenden Gespräch in Let's Meet.

    python scripts/playbook-qr.py <schluessel|alle>

Liest public/playbook-dateien/<schluessel>/playbook.pdf, sucht auf jeder Seite QR-Codes und
ersetzt jeden, der nicht schon auf das richtige Gespräch zeigt (die Originale zeigten auf
Calendly). Über den neuen Code kommt ein klickbarer Link, damit er auch am Bildschirm
funktioniert. Danach werden nur die geänderten Seitenbilder neu gerendert und Größe und Stand
in src/daten/playbook-dateien.json nachgezogen. Läuft auch automatisch am Ende von
scripts/playbook-vorbereiten.py.

Steckt der QR-Code als eigenes Bild in der PDF, wird nur dieses Bild ausgetauscht (gleiche Lage,
gleicher Rahmen). Ist er Teil eines größeren Bildes, kommt der neue Code deckend darüber.

Braucht zusätzlich zu den Paketen von playbook-vorbereiten.py:

    pip install opencv-python-headless qrcode
"""
import io
import json
import sys
from datetime import date
from pathlib import Path

try:
    import cv2
    import numpy as np
    import pymupdf
    import qrcode
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Es fehlen Pakete. Bitte einmal ausführen:  pip install pikepdf pymupdf pillow opencv-python-headless qrcode")

ROOT = Path(__file__).resolve().parent.parent
BASIS = "https://letsmeet.thatsit.marketing"
# Gespräch je Playbook, wie PLAYBOOKS in src/lib/playbooks.ts. Bei Änderung beide Stellen pflegen.
GESPRAECH = {
    "website": "strategiegespraech-webseite",
    "social": "strategiegespraech-social-media",
    "recruiting": "strategiegespraech-recruiting",
    "gastro": "strategiegespraech-social-media",
}
SUCH_DPI = 150
SEITE_PX = 1600
WEBP_QUALITAET = 80


def qr_bild(url: str, kante: int) -> Image.Image:
    """QR-Code ohne Ruhezone, schwarz auf weiß, genau kante x kante Pixel."""
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=0)
    qr.add_data(url)
    qr.make(fit=True)
    matrix = qr.get_matrix()
    n = len(matrix)
    bild = Image.new("L", (kante, kante), 255)
    zeichnen = ImageDraw.Draw(bild)
    for y, zeile in enumerate(matrix):
        for x, an in enumerate(zeile):
            if an:
                x0, y0 = round(x * kante / n), round(y * kante / n)
                x1, y1 = round((x + 1) * kante / n) - 1, round((y + 1) * kante / n) - 1
                zeichnen.rectangle((x0, y0, x1, y1), fill=0)
    return bild.convert("RGB")


def finden(bgr: np.ndarray) -> list[tuple[str, np.ndarray]]:
    ok, texte, punkte, _ = cv2.QRCodeDetector().detectAndDecodeMulti(bgr)
    return list(zip(texte, punkte)) if ok else []


def als_bgr(pix: "pymupdf.Pixmap") -> np.ndarray:
    if pix.alpha or pix.n != 3:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix) if pix.n - pix.alpha != 3 else pix
        if pix.alpha:
            pix = pymupdf.Pixmap(pix, 0)
    rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, 3)
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def bild_ersetzen(doc, seite, info, url) -> bool:
    """QR-Code im eigenen Bild austauschen. False, wenn das nicht geht."""
    xref = info["xref"]
    if not xref or sum(1 for s in doc for b in s.get_images() if b[0] == xref) != 1:
        return False
    original = pymupdf.Pixmap(doc, xref)
    bgr = als_bgr(original)
    treffer = finden(bgr)
    if len(treffer) != 1:
        return False
    _, ecken = treffer[0]
    x0, y0 = ecken.min(axis=0)
    x1, y1 = ecken.max(axis=0)
    kante = int(round(max(x1 - x0, y1 - y0)))
    x0, y0 = int(round((x0 + x1 - kante) / 2)), int(round((y0 + y1 - kante) / 2))
    bild = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    # etwas über den alten Code hinaus weiß, damit keine Kanten stehen bleiben
    rand = max(2, kante // 60)
    ImageDraw.Draw(bild).rectangle((x0 - rand, y0 - rand, x0 + kante + rand, y0 + kante + rand), fill="white")
    bild.paste(qr_bild(url, kante), (x0, y0))
    puffer = io.BytesIO()
    bild.save(puffer, "PNG", optimize=True)
    seite.replace_image(xref, stream=puffer.getvalue())
    return True


def ersetzen(schluessel: str) -> None:
    url = f"{BASIS}/{GESPRAECH[schluessel]}"
    ordner = ROOT / "public" / "playbook-dateien" / schluessel
    pdf = ordner / "playbook.pdf"
    if not pdf.is_file():
        print(f"{schluessel}: keine PDF, übersprungen")
        return
    doc = pymupdf.open(pdf)
    geaendert = []
    for nr, seite in enumerate(doc, 1):
        faktor = SUCH_DPI / 72
        for text, ecken in finden(als_bgr(seite.get_pixmap(dpi=SUCH_DPI))):
            if text == url:
                continue
            rect = pymupdf.Rect(*(ecken.min(axis=0) / faktor), *(ecken.max(axis=0) / faktor))
            infos = [i for i in seite.get_image_info(xrefs=True) if pymupdf.Rect(i["bbox"]).contains(rect)]
            # kleinstes Bild, das den Code enthält, zuerst
            infos.sort(key=lambda i: pymupdf.Rect(i["bbox"]).get_area())
            if not (infos and bild_ersetzen(doc, seite, infos[0], url)):
                rand = rect.width / 40
                seite.draw_rect(rect + (-rand, -rand, rand, rand), color=None, fill=(1, 1, 1), overlay=True)
                kante = 1000
                puffer = io.BytesIO()
                qr_bild(url, kante).save(puffer, "PNG", optimize=True)
                seite.insert_image(rect, stream=puffer.getvalue(), keep_proportion=True, overlay=True)
            seite.insert_link({"kind": pymupdf.LINK_URI, "from": rect, "uri": url})
            geaendert.append(nr)
            print(f"{schluessel}, Seite {nr}: {text or 'unlesbarer Code'} -> {url}")
    if not geaendert:
        print(f"{schluessel}: alle QR-Codes zeigen schon auf {url}")
        doc.close()
        return
    neu = ordner / "playbook.neu.pdf"
    doc.save(neu, garbage=3, deflate=True)
    doc.close()
    neu.replace(pdf)

    doc = pymupdf.open(pdf)
    for nr in sorted(set(geaendert)):
        seite = doc[nr - 1]
        faktor = SEITE_PX / max(seite.rect.width, seite.rect.height)
        pix = seite.get_pixmap(matrix=pymupdf.Matrix(faktor, faktor), alpha=False)
        pix.pil_image().save(ordner / f"seite-{nr:03d}.webp", "WEBP", quality=WEBP_QUALITAET, method=6)
        texte = [t for t, _ in finden(als_bgr(seite.get_pixmap(dpi=SUCH_DPI)))]
        if texte != [url]:
            sys.exit(f"{schluessel}, Seite {nr}: Prüfung fehlgeschlagen, gelesen {texte}")
    doc.close()

    manifest_pfad = ROOT / "src" / "daten" / "playbook-dateien.json"
    manifest = json.loads(manifest_pfad.read_text(encoding="utf-8"))
    if schluessel in manifest:
        manifest[schluessel]["pdfBytes"] = pdf.stat().st_size
        manifest[schluessel]["stand"] = date.today().isoformat()
        manifest_pfad.write_text(json.dumps(dict(sorted(manifest.items())), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{schluessel}: fertig, PDF {pdf.stat().st_size / 1_048_576:.1f} MB, geprüft")


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in {*GESPRAECH, "alle"}:
        sys.exit(__doc__)
    for schluessel in GESPRAECH if sys.argv[1] == "alle" else [sys.argv[1]]:
        ersetzen(schluessel)


if __name__ == "__main__":
    main()
