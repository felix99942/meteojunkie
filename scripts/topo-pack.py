#!/usr/bin/env python3
"""Packt den Höhenspiegel aus scripts/topo-mirror.mjs verlustfrei nach WebP.

Aufruf: python3 scripts/topo-pack.py [--src .cache/topo] [--out .cache/topo-webp]

WARUM WEBP: gemessen (2026-11-05, 12 Kacheln z8–z12) 22 % kleiner als die PNG der
Quelle, Pixel für Pixel identisch. Die Quelle ist bereits so klein, wie PNG es kann:
neu gepackte PNG waren nicht kleiner.

Jede Datei wird nach dem Schreiben zurückgelesen und mit dem Original verglichen. Ein
falsches Höhenbit sähe man nicht als Fehler, sondern als Klippe in der Schummerung,
und unter `immutable` bliebe sie für immer. Ein zweiter Lauf packt nur, was fehlt.
Bibliothek: Pillow (scripts/requirements-nwp.txt).
"""
import argparse
import io
import os
import sys
from multiprocessing import Pool
from pathlib import Path

from PIL import Image


def pack(job: tuple[str, str]) -> tuple[int, int, str | None]:
    """Liefert (Bytes PNG, Bytes WebP, Fehlertext)."""
    src, dst = job
    if os.path.exists(dst):
        return os.path.getsize(src), os.path.getsize(dst), None
    raw = Image.open(src).convert('RGB')
    buf = io.BytesIO()
    raw.save(buf, 'WEBP', lossless=True, quality=100, method=6)
    data = buf.getvalue()
    back = Image.open(io.BytesIO(data)).convert('RGB')
    if back.size != raw.size or back.tobytes() != raw.tobytes():
        return os.path.getsize(src), 0, f'{src}: Pixel weichen ab'
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = f'{dst}.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, dst)
    return os.path.getsize(src), len(data), None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--src', default='.cache/topo')
    ap.add_argument('--out', default='.cache/topo-webp')
    ap.add_argument('--workers', type=int, default=max(1, (os.cpu_count() or 2) - 2))
    args = ap.parse_args()

    src = Path(args.src)
    jobs = [
        (str(p), str(Path(args.out) / p.relative_to(src).with_suffix('.webp')))
        for p in src.rglob('*.png')
    ]
    if not jobs:
        sys.exit(f'keine PNG unter {src}')

    png = webp = done = 0
    errors: list[str] = []
    with Pool(args.workers) as pool:
        for a, b, err in pool.imap_unordered(pack, jobs, chunksize=32):
            done += 1
            png += a
            webp += b
            if err:
                errors.append(err)
            if done % 2000 == 0 or done == len(jobs):
                print(f'{done}/{len(jobs)} · PNG {png / 1e6:.0f} MB → WebP {webp / 1e6:.0f} MB', flush=True)
    for e in errors[:20]:
        print(e, file=sys.stderr)
    if errors:
        sys.exit(f'{len(errors)} Kacheln weichen ab, nichts davon geschrieben')
    print(f'fertig: {done} Kacheln, {100 * webp / png:.1f} % der PNG-Größe')


if __name__ == '__main__':
    main()
