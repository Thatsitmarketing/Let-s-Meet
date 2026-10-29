#!/usr/bin/env python3
"""
Bereitet ein Playbook für Let's Meet vor: PDF verkleinern, Seiten als Bilder für das Flipbook.

    python3 scripts/playbook-vorbereiten.py <schluessel> <pfad/zur.pdf>

schluessel: website, social, recruiting oder gastro (wie in src/lib/playbooks.ts).
Ergebnis in public/playbook-dateien/<schluessel>/ (playbook.pdf, seite-001.webp ...) und ein
Eintrag in src/daten/playbook-dateien.json. Die Dateien sind nicht öffentlich: src/worker.ts
blockt den direkten Aufruf, ausgeliefert wird nur über /playbook/<id>/... mit gültigem Link.

Braucht: poppler (pdftoppm, pdfinfo), ImageMagick (convert mit WebP), Python mit pikepdf und Pillow
(pip install pikepdf pillow). Cloudflare liefert höchstens 25 MiB je Datei aus, deshalb werden
Bilder in der PDF auf höchstens BILD_MAX Pixel verkleinert und neu als JPEG gespeichert, solange
die Datei über ZIEL_MB liegt. Text und Links der PDF bleiben dabei erhalten.
"""
import io, json, shutil, subprocess, sys, tempfile
from datetime import date
from pathlib import Path

SCHLUESSEL = {"website", "social", "recruiting", "gastro"}
ZIEL_MB = 8            # ab dieser Größe werden Bilder in der PDF verkleinert
GRENZE_MB = 24         # mehr nimmt Cloudflare nicht an
SEITE_BREITE = 1600    # Breite der Seitenbilder in Pixeln (bei Hochformat die Höhe)
WEBP_QUALITAET = 80

ROOT = Path(__file__).resolve().parent.parent


def pdf_verkleinern(quelle: Path, ziel: Path, bild_max: int, qualitaet: int) -> None:
    import pikepdf
    from PIL import Image
    from pikepdf import Name, PdfImage

    pdf = pikepdf.open(quelle)
    for obj in pdf.objects:
        if not isinstance(obj, pikepdf.Stream) or obj.get("/Subtype") != Name.Image:
            continue
        if "/SMask" in obj or "/Mask" in obj or obj.get("/ImageMask", False):
            continue  # Bilder mit Transparenz bleiben unverändert
        try:
            bild = PdfImage(obj).as_pil_image()
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
        if len(daten) >= len(obj.read_raw_bytes()) and faktor == 1:
            continue
        obj.write(daten, filter=Name.DCTDecode)
        obj.Width, obj.Height = bild.size
        obj.BitsPerComponent = 8
        if "/DecodeParms" in obj:
            del obj.DecodeParms
        if bild.mode == "CMYK":
            obj.ColorSpace = Name.DeviceCMYK
            obj.Decode = pikepdf.Array([1, 0, 1, 0, 1, 0, 1, 0])  # Adobe JPEG CMYK ist invertiert
        elif "/ICCBased" not in str(obj.get("/ColorSpace", "")):
            obj.ColorSpace = Name.DeviceRGB if bild.mode == "RGB" else Name.DeviceGray
    pdf.remove_unreferenced_resources()
    pdf.save(ziel, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate)


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in SCHLUESSEL:
        sys.exit(__doc__)
    schluessel, quelle = sys.argv[1], Path(sys.argv[2])
    ordner = ROOT / "public" / "playbook-dateien" / schluessel
    shutil.rmtree(ordner, ignore_errors=True)
    ordner.mkdir(parents=True)
    pdf = ordner / "playbook.pdf"

    groesse = quelle.stat().st_size / 1_048_576
    if groesse <= ZIEL_MB:
        shutil.copy(quelle, pdf)
    else:
        # Erst schonend, dann stärker, bis die Datei klein genug ist
        for bild_max, qualitaet in ((2000, 82), (1600, 78), (1300, 72), (1000, 65)):
            pdf_verkleinern(quelle, pdf, bild_max, qualitaet)
            neu = pdf.stat().st_size / 1_048_576
            print(f"PDF {groesse:.1f} MB -> {neu:.1f} MB (Bilder bis {bild_max} px, Qualität {qualitaet})")
            if neu <= ZIEL_MB:
                break
    if pdf.stat().st_size / 1_048_576 > GRENZE_MB:
        sys.exit("Die PDF ist auch verkleinert größer als 24 MB. Bitte eine komprimierte Fassung exportieren.")

    info = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, check=True).stdout
    seiten = int(next(z.split()[-1] for z in info.splitlines() if z.startswith("Pages:")))
    groesse_pt = next(z for z in info.splitlines() if z.startswith("Page size:")).split()
    quer = float(groesse_pt[2]) >= float(groesse_pt[4])

    with tempfile.TemporaryDirectory() as tmp:
        groesse_arg = ["-scale-to-x", str(SEITE_BREITE), "-scale-to-y", "-1"] if quer else ["-scale-to-y", str(SEITE_BREITE), "-scale-to-x", "-1"]
        subprocess.run(["pdftoppm", "-png", *groesse_arg, str(pdf), f"{tmp}/s"], check=True)
        pngs = sorted(Path(tmp).glob("s-*.png"))
        for nr, png in enumerate(pngs, 1):
            subprocess.run(["convert", str(png), "-strip", "-quality", str(WEBP_QUALITAET), str(ordner / f"seite-{nr:03d}.webp")], check=True)
        breite, hoehe = map(int, subprocess.run(["identify", "-format", "%w %h", str(pngs[0])], capture_output=True, text=True, check=True).stdout.split())

    manifest_pfad = ROOT / "src" / "daten" / "playbook-dateien.json"
    manifest = json.loads(manifest_pfad.read_text()) if manifest_pfad.exists() else {}
    manifest[schluessel] = {
        "seiten": seiten,
        "breite": breite,
        "hoehe": hoehe,
        "pdfBytes": pdf.stat().st_size,
        "stand": date.today().isoformat(),
    }
    manifest_pfad.write_text(json.dumps(dict(sorted(manifest.items())), indent=2, ensure_ascii=False) + "\n")
    bilder = sum(p.stat().st_size for p in ordner.glob("seite-*.webp")) / 1_048_576
    print(f"{schluessel}: {seiten} Seiten ({breite} x {hoehe}), PDF {pdf.stat().st_size / 1_048_576:.1f} MB, Seitenbilder zusammen {bilder:.1f} MB")


if __name__ == "__main__":
    main()
