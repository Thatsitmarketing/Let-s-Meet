#!/usr/bin/env python3
"""
Bereitet ein Playbook für Let's Meet vor: PDF verkleinern, Seiten als Bilder für das Flipbook.

    python scripts/playbook-vorbereiten.py <schluessel> <pfad/zur.pdf>

schluessel: website, social, recruiting oder gastro (wie in src/lib/playbooks.ts).
Ergebnis in public/playbook-dateien/<schluessel>/ (playbook.pdf, seite-001.webp ...) und ein
Eintrag in src/daten/playbook-dateien.json. Die Dateien sind nicht öffentlich: src/worker.ts
blockt den direkten Aufruf, ausgeliefert wird nur über /playbook/<id>/... mit gültigem Link.

Braucht nur Python 3.10 oder neuer mit drei Paketen, läuft auf Windows, Mac und Linux:

    pip install pikepdf pymupdf pillow

Cloudflare liefert höchstens 25 MiB je Datei aus. Liegt die PDF über ZIEL_MB, werden die Bilder
darin schrittweise verkleinert und neu als JPEG gespeichert, bis sie passt. Text, Schriften und
Links der PDF bleiben dabei erhalten. Die Originaldatei wird nicht verändert und gehört nicht ins Repo.
"""
import json
import shutil
import sys
from datetime import date
from pathlib import Path

try:
    import io
    import pikepdf
    import pymupdf
    from PIL import Image
except ImportError:
    sys.exit("Es fehlen Pakete. Bitte einmal ausführen:  pip install pikepdf pymupdf pillow")

SCHLUESSEL = {"website", "social", "recruiting", "gastro"}
ZIEL_MB = 8            # ab dieser Größe werden Bilder in der PDF verkleinert
GRENZE_MB = 24         # mehr nimmt Cloudflare nicht an
SEITE_PX = 1600        # lange Kante der Seitenbilder in Pixeln
WEBP_QUALITAET = 80
# Stufen: lange Kante der Bilder in der PDF höchstens so viele Pixel, JPEG Qualität
STUFEN = ((2000, 82), (1600, 78), (1300, 72), (1000, 65))

ROOT = Path(__file__).resolve().parent.parent


def mb(pfad: Path) -> float:
    return pfad.stat().st_size / 1_048_576


def pdf_verkleinern(quelle: Path, ziel: Path, bild_max: int, qualitaet: int) -> None:
    """Verkleinert die Bilder in der PDF und speichert sie neu als JPEG. Text und Links bleiben."""
    pdf = pikepdf.open(quelle)
    for obj in pdf.objects:
        if not isinstance(obj, pikepdf.Stream) or obj.get("/Subtype") != pikepdf.Name.Image:
            continue
        if "/SMask" in obj or "/Mask" in obj or obj.get("/ImageMask", False):
            continue  # Bilder mit Transparenz bleiben unverändert
        try:
            bild = pikepdf.PdfImage(obj).as_pil_image()
        except Exception:
            continue
        if bild.mode not in ("RGB", "L", "CMYK"):
            continue
        b, h = bild.size
        faktor = min(1.0, bild_max / max(b, h))
        if faktor < 1:
            bild = bild.resize((max(1, round(b * faktor)), max(1, round(h * faktor))), Image.LANCZOS)
        puffer = io.BytesIO()
        bild.save(puffer, "JPEG", quality=qualitaet, optimize=True, progressive=True)
        daten = puffer.getvalue()
        if faktor == 1 and len(daten) >= len(obj.read_raw_bytes()):
            continue
        obj.write(daten, filter=pikepdf.Name.DCTDecode)
        obj.Width, obj.Height = bild.size
        obj.BitsPerComponent = 8
        if "/DecodeParms" in obj:
            del obj.DecodeParms
        if bild.mode == "CMYK":
            obj.ColorSpace = pikepdf.Name.DeviceCMYK
            obj.Decode = pikepdf.Array([1, 0, 1, 0, 1, 0, 1, 0])  # Adobe JPEG CMYK ist invertiert
        elif "/ICCBased" not in str(obj.get("/ColorSpace", "")):
            obj.ColorSpace = pikepdf.Name.DeviceRGB if bild.mode == "RGB" else pikepdf.Name.DeviceGray
    pdf.remove_unreferenced_resources()
    pdf.save(ziel, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate)
    pdf.close()


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in SCHLUESSEL:
        sys.exit(__doc__)
    schluessel, quelle = sys.argv[1], Path(sys.argv[2])
    if not quelle.is_file():
        sys.exit(f"Datei nicht gefunden: {quelle}")

    ordner = ROOT / "public" / "playbook-dateien" / schluessel
    shutil.rmtree(ordner, ignore_errors=True)
    ordner.mkdir(parents=True)
    pdf = ordner / "playbook.pdf"

    groesse = mb(quelle)
    if groesse <= ZIEL_MB:
        shutil.copy(quelle, pdf)
        print(f"PDF {groesse:.1f} MB, bleibt unverändert")
    else:
        for bild_max, qualitaet in STUFEN:
            pdf_verkleinern(quelle, pdf, bild_max, qualitaet)
            print(f"PDF {groesse:.1f} MB -> {mb(pdf):.1f} MB (Bilder bis {bild_max} px, Qualität {qualitaet})")
            if mb(pdf) <= ZIEL_MB:
                break
    if mb(pdf) > GRENZE_MB:
        sys.exit("Die PDF ist auch verkleinert größer als 24 MB. Bitte beim Export eine komprimierte Fassung wählen.")

    doc = pymupdf.open(pdf)
    breite = hoehe = 0
    for nr, seite in enumerate(doc, 1):
        faktor = SEITE_PX / max(seite.rect.width, seite.rect.height)
        pix = seite.get_pixmap(matrix=pymupdf.Matrix(faktor, faktor), alpha=False)
        bild = pix.pil_image()
        bild.save(ordner / f"seite-{nr:03d}.webp", "WEBP", quality=WEBP_QUALITAET, method=6)
        if nr == 1:
            breite, hoehe = pix.width, pix.height
    seiten = doc.page_count
    doc.close()

    manifest_pfad = ROOT / "src" / "daten" / "playbook-dateien.json"
    manifest = json.loads(manifest_pfad.read_text(encoding="utf-8")) if manifest_pfad.exists() else {}
    manifest[schluessel] = {
        "seiten": seiten,
        "breite": breite,
        "hoehe": hoehe,
        "pdfBytes": pdf.stat().st_size,
        "stand": date.today().isoformat(),
    }
    manifest_pfad.write_text(json.dumps(dict(sorted(manifest.items())), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    bilder = sum(p.stat().st_size for p in ordner.glob("seite-*.webp")) / 1_048_576
    print(f"Fertig: {schluessel}, {seiten} Seiten ({breite} x {hoehe}), PDF {mb(pdf):.1f} MB, Seitenbilder zusammen {bilder:.1f} MB")
    print(f"Liegt in {ordner.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
