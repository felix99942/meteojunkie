#!/usr/bin/env python3
"""ICON-D2-Modellflächen → Föhn-Querschnitte (je Achse eine kleine Datei).

Warum Modellflächen und nicht die Druckflächen wie bei den Karten: sie folgen dem
Gelände. Nur so ist der Föhnstrom IN den Tälern im Bild, Druckflächen liegen dort
unter dem Boden und sind extrapoliert. Dazu ist `w` eine echte Modellgröße.

Beim DWD je Größe × Fläche × Schritt eine eigene Datei (~1 MB bz2, ganzes Gebiet):
t, u, v, p auf den Vollflächen 1–65, w und hhl auf den Halbflächen 1–66, von oben
nach unten gezählt, hhl (Höhe über NN) zeitlich konstant. Geholt werden nur die Flächen
unterhalb von ZMAX_M, aus dem Feld wird nur die Linie der Achse behalten — das
Ergebnis ist je Achse rund ein MB, die Downloads werden nicht gespeichert.

Aufruf (aus dem Repo-Wurzelverzeichnis):
  python3 scripts/icon-section-ingest.py               neuesten Lauf holen
  python3 scripts/icon-section-ingest.py --latest      nur die Lauf-Kennung
  python3 scripts/icon-section-ingest.py --run 2026110909 --steps 2
"""

from __future__ import annotations

import argparse
import bz2
import gzip
import json
import math
import shutil
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from nwp_common import Missing, OUT_ROOT, decode_grib, http_get, run_id, url_exists

MODEL = 'icon-d2-section'
BASE = 'https://opendata.dwd.de/weather/nwp/icon-d2/grib'
PREFIX = 'icon-d2_germany_regular-lat-lon'
CYCLE_H = 3
# Stündlich, solange man Föhnphasen im Detail liest, danach 3-stündlich: das halbiert
# die Abrufe gegenüber durchgehend stündlich
STEPS = list(range(0, 25)) + list(range(27, 49, 3))
ZMAX_M = 9000.0
THIN_ABOVE_M = 3000.0
SPACING_KM = 2.0
NUM_LEVELS = 65

# Gleiche `id` wie in src/config/foehn.ts. Die Achsen reichen über die Föhnpunkte hinaus,
# damit Anströmung und Auslauf im Bild sind
AXES = {
    'tirol': {
        'label': 'Bozen – Brenner – Innsbruck',
        'waypoints': [
            ('Trient', 46.07, 11.12), ('Bozen', 46.498, 11.354), ('Brenner', 47.004, 11.506),
            ('Innsbruck', 47.26, 11.39), ('Rosenheim', 47.86, 12.13),
        ],
    },
    'schweiz': {
        'label': 'Lugano – Gotthard – Zürich',
        'waypoints': [
            ('Como', 45.81, 9.08), ('Lugano', 46.004, 8.96), ('Gotthard', 46.56, 8.56),
            ('Altdorf', 46.88, 8.64), ('Zürich', 47.458, 8.548), ('Schaffhausen', 47.70, 8.63),
        ],
    },
}


# Nord-Süd-Linien zum Durchziehen, von der Westschweiz bis an den Alpenostrand. Alle 0,1°
# (~7,5 km) eine eigene Datei: die Felder sind ohnehin geholt, jede weitere Linie kostet
# nur Rechnen und ~3 MB, und abgerufen wird nur, was man wirklich ansieht
LON_MIN, LON_MAX, LON_STEP = 6.0, 16.5, 0.1
LAT_SOUTH, LAT_NORTH = 45.0, 48.6


# Windvolumen für die 3D-Partikel der Ansicht „Alpen 3D": dieselben Dateien wie die Schnitte,
# nur als Ausschnitt statt auf Linien. Im vollen Raster (2,2 km): auf 4 km fiel das Wipptal
# durch, und um den Wind in den Tälern geht es
VOLUME_BOX = (44.0, 49.5, 4.0, 18.2)  # lat min/max, lon min/max: der Bereich von „Alpen 3D"
VOLUME_STRIDE = 1
# Höhen über Grund (m), je die nächstgelegene schon geholte Modellfläche
# „Alpen 3D" zeigt den Wind bis 1 km über Grund; 1500 m, damit die Spitze nicht am Rand endet
VOLUME_AGL = (10, 50, 100, 200, 300, 450, 600, 800, 1000, 1500)
VOLUME_UV_STEP = 0.5  # m/s je Stufe, ±63,5 m/s
VOLUME_W_STEP = 0.1  # m/s je Stufe, ±12,7 m/s
VOLUME_MISSING = -128


def meridian_id(tenths: int) -> str:
    return f'lon-{tenths:03d}'


def sections() -> dict:
    """Alle Schnitte: id → Beschriftung und Pfad."""
    out = {a: {'label': c['label'], 'path': build_path(c['waypoints'])} for a, c in AXES.items()}
    for tenths in range(round(LON_MIN * 10), round(LON_MAX * 10) + 1):
        lon = tenths / 10
        path = build_path([('', LAT_SOUTH, lon), ('', LAT_NORTH, lon)])
        # Keine Orte auf der frei gezogenen Linie, die Breite ist die Orientierung
        path['marks'] = [
            {'name': f'{lat:g}° N'.replace('.', ','), 'km': round((lat - LAT_SOUTH) * 111.2, 1)}
            for lat in [LAT_SOUTH + 0.5 * i for i in range(8)]
        ]
        out[meridian_id(tenths)] = {'label': f'{lon:.1f}° O'.replace('.', ','), 'path': path}
    return out


def km_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    k = math.cos(math.radians((a[0] + b[0]) / 2))
    return 111.2 * math.hypot(b[0] - a[0], (b[1] - a[1]) * k)


def build_path(waypoints: list) -> dict:
    """Punkte im festen Abstand entlang der Wegpunkte, dazu die Lage der benannten Orte."""
    pts = [(lat, lon) for _, lat, lon in waypoints]
    seg = [km_between(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    total = sum(seg)
    count = int(total / SPACING_KM) + 1
    km, lat, lon = [], [], []
    for n in range(count):
        s = n * SPACING_KM
        i, rest = 0, s
        while i < len(seg) - 1 and rest > seg[i]:
            rest -= seg[i]
            i += 1
        f = rest / seg[i]
        km.append(round(s, 1))
        lat.append(pts[i][0] + f * (pts[i + 1][0] - pts[i][0]))
        lon.append(pts[i][1] + f * (pts[i + 1][1] - pts[i][1]))
    marks, s = [], 0.0
    for i, (name, _, _) in enumerate(waypoints):
        if name:
            marks.append({'name': name, 'km': round(s, 1)})
        if i < len(seg):
            s += seg[i]
    # EINE Richtung für die ganze Achse (Anfang → Ende). Je Punkt der Linie folgend
    # sprang der Längswind an jedem Knick senkrecht durch die ganze Säule
    k = math.cos(math.radians((pts[0][0] + pts[-1][0]) / 2))
    dx, dy = (pts[-1][1] - pts[0][1]) * k, pts[-1][0] - pts[0][0]
    d = math.hypot(dx, dy)
    return {'km': km, 'lat': lat, 'lon': lon, 'marks': marks, 'east': dx / d, 'north': dy / d}


class Line:
    """Bilineare Abtastung eines regelmäßigen Felds auf allen Achsenpunkten."""

    def __init__(self, lat, lon):
        self.lat, self.lon = lat, lon
        self.prep = None

    def sample(self, vals, grid):
        import numpy as np

        if self.prep is None:
            x = (self.lon - grid['lon0']) / grid['dlon']
            y = (self.lat - grid['lat0']) / grid['dlat']
            i, j = np.floor(x).astype(int), np.floor(y).astype(int)
            if i.min() < 0 or j.min() < 0 or i.max() + 1 >= grid['ni'] or j.max() + 1 >= grid['nj']:
                raise SystemExit('eine Föhnachse liegt außerhalb des ICON-D2-Gebiets')
            self.prep = (i, j, x - i, y - j)
        i, j, fx, fy = self.prep
        return (
            vals[j, i] * (1 - fx) * (1 - fy) + vals[j, i + 1] * fx * (1 - fy)
            + vals[j + 1, i] * (1 - fx) * fy + vals[j + 1, i + 1] * fx * fy
        ).astype(np.float32)


def level_url(run: datetime, step: int, level: int, var: str) -> str:
    return f'{BASE}/{run:%H}/{var}/{PREFIX}_model-level_{run_id(run)}_{step:03d}_{level}_{var}.grib2.bz2'


def hhl_url(run: datetime, level: int) -> str:
    return f'{BASE}/{run:%H}/hhl/{PREFIX}_time-invariant_{run_id(run)}_000_{level}_hhl.grib2.bz2'


def fetch(url: str) -> bytes:
    # bz2 gibt beim Entpacken das GIL frei, eccodes bleibt im Hauptthread
    return bz2.decompress(http_get(url, deadline=30))


def run_complete(run: datetime) -> bool:
    return url_exists(level_url(run, STEPS[-1], NUM_LEVELS, 't'))


def latest_run(now: datetime) -> datetime:
    base = now.replace(minute=0, second=0, microsecond=0)
    base = base.replace(hour=base.hour - base.hour % CYCLE_H)
    for i in range(24 // CYCLE_H + 1):
        run = base - timedelta(hours=CYCLE_H * i)
        if run_complete(run):
            return run
    raise SystemExit('kein vollständiger ICON-D2-Lauf mit Modellflächen in den letzten 24 h')


NO_VALUE = -32768


def packed(arr, factor: float):
    """Als int16: Python-Listen wären über alle Schnitte mehrere GB im Speicher."""
    import numpy as np

    scaled = np.clip(np.round(arr * factor), -32767, 32767)
    return np.where(np.isfinite(scaled), scaled, NO_VALUE).astype(np.int16)


def crop_slices(grid: dict) -> tuple:
    """Ausschnitt des Windvolumens im Raster dieses Felds."""
    lat0, lat1, lon0, lon1 = VOLUME_BOX
    j0 = round((lat0 - grid['lat0']) / grid['dlat'])
    j1 = round((lat1 - grid['lat0']) / grid['dlat']) + 1
    i0 = round((lon0 - grid['lon0']) / grid['dlon'])
    i1 = round((lon1 - grid['lon0']) / grid['dlon']) + 1
    return slice(j0, j1, VOLUME_STRIDE), slice(i0, i1, VOLUME_STRIDE)


def packed_i8(arr, step: float):
    import numpy as np

    v = np.round(arr / step)
    return np.where(np.isfinite(v), np.clip(v, -127, 127), VOLUME_MISSING).astype(np.int8)


def meters_i16(arr):
    import numpy as np

    return np.nan_to_num(np.round(arr), nan=0.0).astype(np.int16)


def unpacked(arr) -> list:
    """Schritte × Flächen × Punkte als Listen; kein Wert = null."""
    return [[[None if v == NO_VALUE else v for v in row] for row in level] for level in arr.tolist()]


def main() -> None:
    import numpy as np

    ap = argparse.ArgumentParser()
    ap.add_argument('--latest', action='store_true', help='nur die Kennung des neuesten Laufs ausgeben')
    ap.add_argument('--run', help='Lauf YYYYMMDDHH statt des neuesten')
    ap.add_argument('--steps', type=int, help='nur die ersten N Schritte (Entwicklung)')
    args = ap.parse_args()

    run = (datetime.strptime(args.run, '%Y%m%d%H').replace(tzinfo=timezone.utc)
           if args.run else latest_run(datetime.now(timezone.utc)))
    rid = run_id(run)
    if args.latest:
        print(rid)
        return
    steps = STEPS[: args.steps] if args.steps else STEPS
    out = OUT_ROOT / MODEL
    meta_path = out / 'meta.json'
    if meta_path.exists():
        old = json.loads(meta_path.read_text())
        if old.get('runId') == rid and old.get('steps') == steps and (out / rid).is_dir():
            print(f'Querschnitt Lauf {rid} liegt schon vollständig vor — nichts zu tun', flush=True)
            return

    t0 = time.time()
    defs = sections()
    paths = {a: d['path'] for a, d in defs.items()}
    slices, start = {}, 0
    for a, p in paths.items():
        slices[a] = (start, start + len(p['km']))
        start += len(p['km'])
    line = Line(
        np.concatenate([np.array(p['lat']) for p in paths.values()]),
        np.concatenate([np.array(p['lon']) for p in paths.values()]),
    )

    with ThreadPoolExecutor(max_workers=16) as pool:
        # Halbflächen-Höhen: daraus folgt, welche Flächen unter ZMAX_M liegen
        futs = {k: pool.submit(fetch, hhl_url(run, k)) for k in range(1, NUM_LEVELS + 2)}
        hhl = {}
        hhl_crop = {}
        slices_vol = None
        vol_grid = None
        for k, fut in futs.items():
            vals, grid, _ = decode_grib(fut.result())
            hhl[k] = line.sample(vals, grid)
            if slices_vol is None:
                slices_vol = crop_slices(grid)
                vol_grid = grid
            hhl_crop[k] = vals[slices_vol].astype(np.float32)
        full = {k: 0.5 * (hhl[k] + hhl[k + 1]) for k in range(1, NUM_LEVELS + 1)}
        top = next(k for k in range(1, NUM_LEVELS + 1) if float(np.nanmean(full[k])) < ZMAX_M)
        # Oberhalb von THIN_ABOVE_M jede zweite Fläche: dort ist die Atmosphäre glatt, und
        # jede Fläche sind fünf Abrufe je Schritt
        levels = [
            k for k in range(top, NUM_LEVELS + 1)
            if float(np.nanmean(full[k])) < THIN_ABOVE_M or (k - top) % 2 == 0
        ]
        half = sorted({h for k in levels for h in (k, k + 1)})
        # Volumen: je Zielhöhe die nächste schon geholte Fläche, von unten nach oben
        surface = hhl_crop[NUM_LEVELS + 1]
        agl = {k: float(np.nanmean(0.5 * (hhl_crop[k] + hhl_crop[k + 1]) - surface)) for k in levels}
        vol_levels = list(dict.fromkeys(min(levels, key=lambda k: abs(agl[k] - target)) for target in VOLUME_AGL))
        vol_tmp = Path(tempfile.mkdtemp(prefix='icon-wind3d-'))
        print(f'Querschnitt Lauf {rid}: {len(levels)} Flächen ab {top}, {len(steps)} Schritte, '
              f'{start} Achsenpunkte', flush=True)

        def load(step: int) -> dict:
            jobs = {(v, k): pool.submit(fetch, level_url(run, step, k, v)) for v in ('t', 'u', 'v', 'p') for k in levels}
            jobs.update({('w', k): pool.submit(fetch, level_url(run, step, k, 'w')) for k in half})
            res = {}
            needed = {('u', k) for k in vol_levels} | {('v', k) for k in vol_levels}
            needed |= {('w', h) for k in vol_levels for h in (k, k + 1)}
            for key, fut in jobs.items():
                vals, grid, _ = decode_grib(fut.result())
                res[key] = line.sample(vals, grid)
                if key in needed:
                    res['crop', *key] = vals[slices_vol].astype(np.float32)
            return res

        fields = {a: {'theta': [], 'along': [], 'w': []} for a in paths}
        for n, step in enumerate(steps):
            try:
                f = load(step)
            except Missing as e:
                raise SystemExit(f'Datei fehlt: {e}') from e
            # Von unten nach oben, wie im Diagramm
            order = list(reversed(levels))
            t = np.stack([f['t', k] for k in order])
            p = np.stack([f['p', k] for k in order])
            u = np.stack([f['u', k] for k in order])
            v = np.stack([f['v', k] for k in order])
            w = np.stack([0.5 * (f['w', k] + f['w', k + 1]) for k in order])
            theta = t * (100000.0 / p) ** 0.2854
            for a, (i0, i1) in slices.items():
                along = u[:, i0:i1] * paths[a]['east'] + v[:, i0:i1] * paths[a]['north']
                fields[a]['theta'].append(packed(theta[:, i0:i1], 10))
                fields[a]['along'].append(packed(along, 10))
                fields[a]['w'].append(packed(w[:, i0:i1], 100))
            # Windvolumen dieses Schritts: Flächen von unten nach oben, je Fläche u, v, w
            volume = []
            for k in vol_levels:
                volume += [
                    packed_i8(f['crop', 'u', k], VOLUME_UV_STEP),
                    packed_i8(f['crop', 'v', k], VOLUME_UV_STEP),
                    packed_i8(0.5 * (f['crop', 'w', k] + f['crop', 'w', k + 1]), VOLUME_W_STEP),
                ]
            (vol_tmp / f'{step:03d}.bin').write_bytes(gzip.compress(np.stack(volume).tobytes(), 6))
            print(f'  {n + 1}/{len(steps)} Schritte, {time.time() - t0:.0f} s', flush=True)

    tmp = out / f'.{rid}.tmp'
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    order = list(reversed(levels))
    for a, (i0, i1) in slices.items():
        p = paths[a]
        doc = {
            'id': a, 'label': defs[a]['label'], 'runId': rid, 'steps': steps,
            'km': p['km'], 'marks': p['marks'],
            'terrain': [round(float(x)) for x in hhl[NUM_LEVELS + 1][i0:i1]],
            'z': [[round(float(x)) for x in full[k][i0:i1]] for k in order],
            # theta in 0,1 K, along in 0,1 m/s (+ zum Achsenende), w in 0,01 m/s (+ aufwärts)
            **{name: unpacked(np.stack(v)) for name, v in fields[a].items()},
        }
        (tmp / f'{a}.json').write_text(json.dumps(doc, separators=(',', ':')))
    # Höhen des Volumens (m über NN) von unten nach oben, danach das Modellgelände
    heights = [meters_i16(0.5 * (hhl_crop[k] + hhl_crop[k + 1])) for k in vol_levels]
    heights.append(meters_i16(surface))
    (vol_tmp / 'grid.bin').write_bytes(gzip.compress(np.stack(heights).tobytes(), 6))
    shutil.move(str(vol_tmp), str(tmp / 'wind3d'))
    final = out / rid
    shutil.rmtree(final, ignore_errors=True)
    tmp.rename(final)
    meta_path.write_text(json.dumps({
        'model': MODEL, 'runId': rid, 'run': run.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'steps': steps, 'levels': len(levels), 'axes': [{'id': a, 'label': c['label']} for a, c in AXES.items()],
        'meridians': {'min': LON_MIN, 'max': LON_MAX, 'step': LON_STEP, 'latSouth': LAT_SOUTH, 'latNorth': LAT_NORTH},
        'wind3d': {
            'nx': int(surface.shape[1]), 'ny': int(surface.shape[0]), 'levels': len(vol_levels),
            'lon0': round(vol_grid['lon0'] + slices_vol[1].start * vol_grid['dlon'], 6),
            'lat0': round(vol_grid['lat0'] + slices_vol[0].start * vol_grid['dlat'], 6),
            'dlon': round(vol_grid['dlon'] * VOLUME_STRIDE, 6), 'dlat': round(vol_grid['dlat'] * VOLUME_STRIDE, 6),
            'uvStep': VOLUME_UV_STEP, 'wStep': VOLUME_W_STEP, 'missing': VOLUME_MISSING,
        },
    }, separators=(',', ':')))
    for old in out.iterdir():
        if old.is_dir() and old.name != rid:
            shutil.rmtree(old, ignore_errors=True)
    size = sum(f.stat().st_size for f in final.iterdir()) / 1e6
    print(f'Querschnitt Lauf {rid} fertig: {size:.1f} MB in {time.time() - t0:.0f} s', flush=True)


if __name__ == '__main__':
    main()
