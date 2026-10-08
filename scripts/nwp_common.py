"""Gemeinsamer Kern der Modellkarten-Ingests (ECMWF IFS, DWD ICON-D2/EU).

Jede Quelle liefert je Zeitschritt nur ihre Felder unter EINHEITLICHEN Namen
(`fetch_step` in `ecmwf-ingest.py` / `icon-ingest.py`); alles Übrige — Größen
ableiten, als Wertebild kodieren, Lauf atomar ablegen, Metadaten schreiben —
steht hier einmal.

Einheitliche Feldnamen und Einheiten:
  t2m, t850    K
  msl          Pa
  tp           mm SEIT INIT aufsummiert (ECMWF liefert m, DWD kg/m² = mm)
  u10, v10     m/s
  gust         m/s, höchste Böe im Intervall `gust_hours` vor dem Termin
  gh500        geopotentielle Höhe in m (DWD liefert Geopotential m²/s²)
  tcc          %
  clch, clcm, clcl   % Bedeckung hoch/mittel/tief (nur ICON — ECMWF Open Data
                     führt nur `tcc`, im Index nachgesehen 2026-10-05)

Ausgabe (`public/nwp/<modell>/`, gitignored):
  meta.json                       Lauf, Raster, je Größe lo/step/Schritte(/Intervalle)
  <lauf>/<größe>/<schritt>.webp   verlustfreies WebP, Wert als 16-Bit-Code in R (hoch) + G (tief)

Kodierung: code = round((wert − lo) / step) + 1, 0 = kein Wert. Der Lauf steht
im PFAD — jede Datei ist unveränderlich, ein neuer Lauf hat neue URLs.
Ausnahme `clouds` (`encoding: 'rgb3'`): drei Schichten in EINEM Bild, je
Kanal die Bedeckung in % (0–100) — R = mittel, G = hoch, B = tief, 255 = kein
Wert. So liegt die Farbmischung der Anzeige (hoch grün, mittel rot, tief
blau) schon in den Kanälen.
Ausnahme `uv10` (`encoding: 'uv8'`): die WINDKOMPONENTEN für die
Partikel-Animation, R = u (nach Osten), G = v (nach Norden), je 8 Bit:
wert = (code − 128) · 0,5 m/s, 0 = kein Wert, Bereich ±63,5 m/s (darüber
geklemmt — die Animation zeigt Richtung und Tempo, die Zahl steht im Feld
`wind10`). 8 statt 16 Bit, weil 0,5 m/s für eine Strömungsbewegung reichen
und das Bild so klein bleibt.
"""

from __future__ import annotations

import io
import json
import shutil
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

OUT_ROOT = Path(__file__).resolve().parent.parent / 'public' / 'nwp'

# Je Größe Wertebereich und Auflösung der Kodierung — für ALLE Modelle gleich,
# damit die Farbskalen im Browser modellunabhängig bleiben. Die Auflösung liegt
# unter der Stufung der Skalen (2-K-Bänder, ≥ 4-hPa-Bänder …); gemessen T2m
# 0,25 K ≈ 210–300 KB, MSL 0,5 hPa ≈ 55–160 KB je Schritt.
VARIABLES = {
    't2m': {'lo': -90.0, 'step': 0.25, 'unit': '°C'},
    't850': {'lo': -70.0, 'step': 0.25, 'unit': '°C'},
    'msl': {'lo': 880.0, 'step': 0.5, 'unit': 'hPa'},
    # mittlere Rate im Intervall seit dem vorigen Schritt; bei +0 gibt es keins
    'precip': {'lo': 0.0, 'step': 0.05, 'unit': 'mm/h'},
    # 1 km/h: die Skalen stufen ab 5 km/h, mit 0,5 waren es die größten Bilder
    'wind10': {'lo': 0.0, 'step': 1.0, 'unit': 'km/h'},
    'gust': {'lo': 0.0, 'step': 1.0, 'unit': 'km/h'},
    'gh500': {'lo': 400.0, 'step': 0.1, 'unit': 'gpdm'},
    # Bewölkung in 5-%-Stufen: die Skalen stufen in 10 %, und in 1-%-Schritten
    # ist das Feld verrauscht — gemessen ICON-D2 Schichten 639 KB je Bild
    'tcc': {'lo': 0.0, 'step': 5.0, 'unit': '%'},
    'clouds': {'lo': 0.0, 'step': 5.0, 'unit': '%', 'encoding': 'rgb3'},
    'uv10': {'lo': -63.5, 'step': 0.5, 'unit': 'm/s', 'encoding': 'uv8'},
}

# Felder, die eine Größe braucht (ohne sie fehlt der Schritt)
NEEDS = {
    't2m': ('t2m',), 't850': ('t850',), 'msl': ('msl',), 'precip': ('tp',),
    'wind10': ('u10', 'v10'), 'gust': ('gust',), 'gh500': ('gh500',), 'tcc': ('tcc',),
    'clouds': ('clch', 'clcm', 'clcl'), 'uv10': ('u10', 'v10'),
}
# Größen, die nicht jedes Modell hat — ihr Fehlen ist kein Fehler
OPTIONAL = {'gust', 'precip', 'clouds'}

# Die Abrufe bei ECMWF TRÖPFELN sporadisch (gemessen 2026-10-05: derselbe
# 8-MB-Bereich einmal mit 7,8 MB/s, einmal mit 90 KB/s = 88 s). Ein
# Socket-Timeout greift dabei nicht, es fließen ja Daten — deshalb eine
# GESAMTfrist je Abruf mit Neuversuch. Beim DWD (22–26 MB/s, 0 Fehler in 216
# Abrufen) schadet sie nicht.
DEADLINE_S = 8


class Missing(Exception):
    """Feld gibt es zu diesem Schritt nicht (HTTP 404)."""


def http_get(url: str, rng: tuple[int, int] | None = None, tries: int = 8) -> bytes:
    headers = {'User-Agent': 'meteo-workbench ingest'}
    if rng:
        headers['Range'] = f'bytes={rng[0]}-{rng[0] + rng[1] - 1}'
    for attempt in range(tries):
        try:
            t0 = time.monotonic()
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=DEADLINE_S) as r:
                chunks = []
                while chunk := r.read(1 << 16):
                    chunks.append(chunk)
                    if time.monotonic() - t0 > DEADLINE_S:
                        raise TimeoutError('Gesamtfrist überschritten')
                return b''.join(chunks)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if isinstance(e, urllib.error.HTTPError) and e.code == 404:
                raise Missing(url) from e
            if attempt == tries - 1:
                raise
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError('unreachable')


def url_exists(url: str) -> bool:
    try:
        req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'meteo-workbench ingest'})
        with urllib.request.urlopen(req, timeout=20):
            return True
    except urllib.error.HTTPError:
        return False


def decode_grib(raw: bytes):
    """GRIB-Nachricht → (Werte NJ×NI, Raster, Intervall in Stunden).

    Raster und Abtastrichtung kommen aus der Nachricht, nicht aus Annahmen:
    ECMWF tastet von Nord nach Süd ab, ICON von Süd nach Nord
    (`jScansPositively`) — mit fester Annahme stünde ein Modell kopf.
    """
    import eccodes
    import numpy as np

    h = eccodes.codes_new_from_message(raw)
    try:
        g = lambda k: eccodes.codes_get(h, k)  # noqa: E731
        ni, nj = g('Ni'), g('Nj')
        vals = eccodes.codes_get_values(h).reshape(nj, ni)
        if g('bitmapPresent'):
            vals = np.where(vals == g('missingValue'), np.nan, vals)
        if g('iScansNegatively'):
            raise RuntimeError('Abtastung von Ost nach West wird nicht unterstützt')
        dlon = g('iDirectionIncrementInDegrees')
        dlat = g('jDirectionIncrementInDegrees') * (1 if g('jScansPositively') else -1)
        lon0 = g('longitudeOfFirstGridPointInDegrees')
        lon0 = lon0 - 360 if lon0 >= 180 else lon0
        grid = {
            'ni': ni, 'nj': nj,
            'lon0': round(lon0, 6), 'lat0': round(g('latitudeOfFirstGridPointInDegrees'), 6),
            'dlon': dlon, 'dlat': dlat,
            # global = die Länge schließt sich (Spalte ni−1 grenzt an Spalte 0)
            'global': abs(ni * dlon - 360) < 1e-6,
        }
        rng = str(g('stepRange'))
        hours = 0
        if '-' in rng:
            a, b = rng.split('-')
            hours = int(b) - int(a)
        return vals, grid, hours
    finally:
        eccodes.codes_release(h)


def derive(var: str, f: dict, prev_tp, step: int, prev_step: int | None):
    """Größe in Anzeigeeinheit, oder None, wenn sie zu diesem Schritt fehlt."""
    import numpy as np

    if var == 't2m':
        return f['t2m'] - 273.15
    if var == 't850':
        return f['t850'] - 273.15
    if var == 'msl':
        return f['msl'] / 100.0
    if var == 'precip':
        if prev_tp is None or prev_step is None:
            return None
        # die Differenz kann durch die Kompression minimal negativ werden
        return np.maximum(0.0, (f['tp'] - prev_tp) / (step - prev_step))
    if var == 'wind10':
        return np.hypot(f['u10'], f['v10']) * 3.6
    if var == 'gust':
        # Intervall 0 = Analysezeitpunkt, dort gibt es keine Böe (stepRange „0")
        return None if f.get('gust_hours', 0) <= 0 else f['gust'] * 3.6
    if var == 'gh500':
        return f['gh500'] / 10.0
    if var == 'tcc':
        return f['tcc']
    if var == 'clouds':
        import numpy as np
        return np.stack([f['clcm'], f['clch'], f['clcl']], axis=-1)
    if var == 'uv10':
        return np.stack([f['u10'], f['v10']], axis=-1)
    raise KeyError(var)


def encode_rgb3(values) -> bytes:
    """Drei Bedeckungen (NJ×NI×3, %) → RGB-WebP in 5-%-Stufen, 255 = kein Wert."""
    import numpy as np
    from PIL import Image

    v = np.clip(np.round(values / 5) * 5, 0, 100)
    v = np.where(np.isfinite(values), v, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(v, 'RGB').save(buf, 'WEBP', lossless=True, method=4)
    return buf.getvalue()


def encode_uv8(values) -> bytes:
    """Windkomponenten (NJ×NI×2, m/s) → RGB-WebP, R = u, G = v, je (code − 128) · 0,5, 0 = kein Wert."""
    import numpy as np
    from PIL import Image

    code = np.clip(np.round(values / 0.5) + 128, 1, 255)
    ok = np.isfinite(values).all(axis=-1, keepdims=True)
    code = np.where(ok, code, 0).astype(np.uint8)
    rgb = np.zeros(values.shape[:-1] + (3,), np.uint8)
    rgb[..., :2] = code
    buf = io.BytesIO()
    Image.fromarray(rgb, 'RGB').save(buf, 'WEBP', lossless=True, method=4)
    return buf.getvalue()


def encode(values, lo: float, step: float) -> bytes:
    import numpy as np
    from PIL import Image

    code = np.round((values - lo) / step) + 1
    code = np.where(np.isfinite(values), np.clip(code, 1, 65535), 0).astype(np.uint16)
    rgb = np.zeros(values.shape + (3,), np.uint8)
    rgb[..., 0] = code >> 8
    rgb[..., 1] = code & 255
    buf = io.BytesIO()
    # method 4: gemessen 0,31 s gegen 0,44 s bei method 6, für 1 % Größe
    Image.fromarray(rgb).save(buf, 'WEBP', lossless=True, method=4)
    return buf.getvalue()


def run_id(run: datetime) -> str:
    return f'{run:%Y%m%d%H}'


def already_done(model: str, rid: str, step_count: int) -> bool:
    meta = OUT_ROOT / model / 'meta.json'
    if not meta.exists():
        return False
    old = json.loads(meta.read_text())
    # Eine neu hinzugekommene Größe (z. B. `uv10`) fehlt einem schon
    # abgelegten Lauf — dann muss er neu erzeugt werden, sonst bliebe sie bis
    # zum nächsten Lauf weg
    complete = all(v in old.get('variables', {}) for v in VARIABLES if v not in OPTIONAL)
    return complete and old.get('runId') == rid and old.get('stepCount') == step_count and (OUT_ROOT / model / rid).is_dir()


def ingest(
    model: str,
    label: str,
    run: datetime,
    steps: list[int],
    fetch_step: Callable[[int, ThreadPoolExecutor], dict],
    *,
    step_window: int = 6,
    field_workers: int = 12,
    encode_workers: int = 4,
) -> None:
    """Einen Lauf holen, kodieren und atomar unter public/nwp/<model>/ ablegen."""
    out = OUT_ROOT / model
    rid = run_id(run)
    if already_done(model, rid, len(steps)):
        print(f'{label} Lauf {rid} liegt schon vollständig vor — nichts zu tun', flush=True)
        return

    t0 = time.time()
    print(f'{label} Lauf {rid}, {len(steps)} Schritte', flush=True)
    tmp = out / f'.{rid}.tmp'
    shutil.rmtree(tmp, ignore_errors=True)
    have: dict[str, list[int]] = {v: [] for v in VARIABLES}
    intervals: dict[str, list[int]] = {'precip': [], 'gust': []}
    sizes: dict[str, int] = {v: 0 for v in VARIABLES}
    grid = None

    def write(var: str, step: int, values) -> None:
        spec = VARIABLES[var]
        enc = spec.get('encoding')
        data = (
            encode_rgb3(values) if enc == 'rgb3'
            else encode_uv8(values) if enc == 'uv8'
            else encode(values, spec['lo'], spec['step'])
        )
        path = tmp / var / f'{step:03d}.webp'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        sizes[var] += len(data)

    # Gleitendes Fenster: das Netz arbeitet parallel, verarbeitet wird in
    # Reihenfolge — der Niederschlag braucht den vorigen Schritt.
    with ThreadPoolExecutor(field_workers) as fpool, ThreadPoolExecutor(step_window) as spool, \
            ThreadPoolExecutor(encode_workers) as epool:
        pending = [spool.submit(fetch_step, s, fpool) for s in steps[:step_window]]
        writes = []
        prev_tp, prev_step = None, None
        for i, step in enumerate(steps):
            f = pending[i].result()
            if i + step_window < len(steps):
                pending.append(spool.submit(fetch_step, steps[i + step_window], fpool))
            pending[i] = None  # Speicher freigeben
            g = f.pop('_grid')
            if grid is None:
                grid = g
            elif g != grid:
                raise RuntimeError(f'Raster wechselt bei +{step} h: {g} statt {grid}')
            for var in VARIABLES:
                if any(k not in f for k in NEEDS[var]):
                    if var not in OPTIONAL:
                        print(f'  ! {var} fehlt bei +{step} h', file=sys.stderr)
                    continue
                values = derive(var, f, prev_tp, step, prev_step)
                if values is None:
                    continue
                have[var].append(step)
                if var == 'precip':
                    intervals['precip'].append(step - prev_step)
                elif var == 'gust':
                    intervals['gust'].append(f['gust_hours'])
                writes.append(epool.submit(write, var, step, values))
            prev_tp, prev_step = f.get('tp'), step
            if (i + 1) % 10 == 0:
                print(f'  {i + 1}/{len(steps)} Schritte, {time.time() - t0:.0f} s', flush=True)
        for w in writes:
            w.result()

    # Erst jetzt umhängen: ein abgebrochener Lauf hinterlässt nur das .tmp,
    # der vorige Stand bleibt unangetastet.
    final = out / rid
    shutil.rmtree(final, ignore_errors=True)
    tmp.rename(final)
    meta = {
        'model': model,
        'runId': rid,
        'run': run.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'stepCount': len(steps),
        'grid': grid,
        'variables': {
            v: {
                'lo': s['lo'], 'step': s['step'], 'unit': s['unit'], 'steps': have[v],
                **({'intervals': intervals[v]} if v in intervals else {}),
                **({'encoding': s['encoding']} if 'encoding' in s else {}),
            }
            for v, s in VARIABLES.items()
            if have[v]  # was das Modell gar nicht führt, steht nicht in meta.json
        },
    }
    (out / 'meta.json').write_text(json.dumps(meta, separators=(',', ':')))
    for old in out.iterdir():
        if old.is_dir() and old.name != rid:
            shutil.rmtree(old, ignore_errors=True)

    total = sum(sizes.values())
    for v in VARIABLES:
        n = max(1, len(have[v]))
        print(f'  {v:7s} {len(have[v]):3d} Schritte, {sizes[v] / 1e6:6.1f} MB ({sizes[v] / n / 1024:.0f} KB je Bild)')
    print(f'  gesamt {total / 1e6:.1f} MB in {time.time() - t0:.0f} s', flush=True)
