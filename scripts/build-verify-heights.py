#!/usr/bin/env python3
"""Genäherte MODELLHÖHE an den Klimastationen für Varda und C-LAEF.

Warum: die Verifikation vergleicht die Temperatur der Modellzelle mit der
Station. Open-Meteo rechnet seine Modelle auf die Stationshöhe um, für C-LAEF
liefert der GeoSphere Data Hub aber KEINE Orografie (gemessen 2026-11-24:
16 Größen, kein z/hsurf; die Punkt-API nennt nur die Koordinaten des
Gitterpunkts). Ohne Umrechnung bekäme ein 1-km-Modell an Gipfel- und
Talstationen 1–2 K „Bias", der nichts mit der Vorhersage zu tun hat
(Valluga +359 m, Sonnblick +351 m über der Zelle, St. Leonhard im Pitztal
−234 m darunter).

Näherung: das ~30-m-Geländemodell (AWS Terrain Tiles, Terrarium z12) über die
1-km-Zelle jedes der vier umliegenden Gitterpunkte gemittelt und so gewichtet
wie die bilineare Interpolation in `nwp_common.sample_points`. Die echte
Modellorografie ist eher noch glatter — an Gipfeln ist der Unterschied also
eher eine Untergrenze.

Aufruf (braucht numpy und Pillow, z. B. aus ~/varda-test/.venv-fc):
  python3 scripts/build-verify-heights.py
Schreibt src/config/ownVerifyHeights.json; Kacheln im Cache-Verzeichnis
(`--cache`, Vorgabe ~/.cache/meteojunkie/terrarium).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
Z = 12
# Gitter wie in den Ingests: C-LAEF (Data Hub nwp-v2-1h-1km), Varda (0,01° aus varda-ingest.py)
GRIDS = {
    'arome-at': {'lon0': 5.0317, 'lat0': 43.002, 'dlon': 0.0135, 'dlat': 0.009},
    'varda': {'lon0': -0.8, 'lat0': 42.05, 'dlon': 0.01, 'dlat': 0.01},
}
# Zellgröße für das Mittel: 1 km (bei Varda ist das 0,01°-Gitter aus dem
# ~1-km-ICON-Gitter interpoliert, die Zellen dort sind ebenfalls ~1 km)
CELL = (0.0135, 0.009)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=str(Path.home() / '.cache' / 'meteojunkie' / 'terrarium'))
    args = ap.parse_args()
    cache = Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)
    stations = [s for s in json.loads((ROOT / 'public/at/stations.json').read_text())['stations'] if s.get('isActive')]

    def txy(lon: float, lat: float) -> tuple[float, float]:
        n = 2 ** Z
        x = (lon + 180) / 360 * n
        y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
        return x, y

    def path(k: tuple[int, int]) -> Path:
        return cache / f'{Z}_{k[0]}_{k[1]}.png'

    need = set()
    for s in stations:
        for dx in (-0.03, 0, 0.03):
            for dy in (-0.03, 0, 0.03):
                x, y = txy(s['lon'] + dx, s['lat'] + dy)
                need.add((int(x), int(y)))

    def fetch(k: tuple[int, int]) -> None:
        if path(k).exists():
            return
        url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{k[0]}/{k[1]}.png'
        for attempt in range(5):
            try:
                tmp = path(k).with_suffix('.part')
                urllib.request.urlretrieve(url, tmp)
                tmp.rename(path(k))
                return
            except OSError:
                if attempt == 4:
                    raise
                time.sleep(2 * (attempt + 1))

    with ThreadPoolExecutor(16) as ex:
        list(ex.map(fetch, need))

    tiles: dict = {}

    def elev(lon: float, lat: float) -> float:
        x, y = txy(lon, lat)
        k = (int(x), int(y))
        if k not in tiles:
            a = np.asarray(Image.open(path(k)).convert('RGB'), dtype=np.float64)
            tiles[k] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
        return float(tiles[k][min(255, int((y % 1) * 256)), min(255, int((x % 1) * 256))])

    def cell_mean(lon: float, lat: float) -> float:
        return float(np.mean([elev(lon + (i / 6 - 0.5) * CELL[0], lat + (j / 6 - 0.5) * CELL[1]) for i in range(7) for j in range(7)]))

    out: dict = {'source': 'AWS Terrain Tiles (Terrarium z12), 1-km-Zellmittel, bilinear', 'models': {}}
    for model, g in GRIDS.items():
        hs = {}
        for s in stations:
            x = (s['lon'] - g['lon0']) / g['dlon']
            y = (s['lat'] - g['lat0']) / g['dlat']
            i0, j0 = math.floor(x), math.floor(y)
            fx, fy = x - i0, y - j0
            h = 0.0
            for di, dj, w in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
                h += w * cell_mean(g['lon0'] + (i0 + di) * g['dlon'], g['lat0'] + (j0 + dj) * g['dlat'])
            hs[str(s['id'])] = round(h)
        out['models'][model] = hs
        d = np.array([s['altitude'] - hs[str(s['id'])] for s in stations])
        print(f'{model}: {len(hs)} Stationen, |Station − Zelle| Median {np.median(abs(d)):.0f} m, > 100 m: {(abs(d) > 100).sum()}')
    dest = ROOT / 'src/config/ownVerifyHeights.json'
    dest.write_text(json.dumps(out, separators=(',', ':')) + '\n')
    print(f'→ {dest.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
