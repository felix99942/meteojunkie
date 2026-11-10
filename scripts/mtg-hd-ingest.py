#!/usr/bin/env python3
"""MTG HD: eigenes Satellitenbild aus den FCI-Rohdaten (Level 1C) — tagsüber
Echtfarben, auf 500 m geschärft, nachts Infrarot 10,5 µm, je Pixel nach dem
Sonnenstand überblendet. Das Bild, das sat24 als „HD" zeigt; EUMETView gibt es
so nicht her (Farbe dort ~1,6 km, scharf nur der Graustufenkanal und nachts schwarz).

Läuft auf dem Laptop per systemd-Timer (scripts/mtg-hd-cron.sh), nicht im Deploy:
~400 MB Download und einige Minuten Rechnen je 10-Minuten-Termin.

Gemessen 2026-11-10:
  * Data Store (EUMDAC), Sammlungen EO:EUM:DAT:0662 (FDHSI, 1 km/2 km) und 0665
    (HRFI, 500 m/1 km). Ein Termin liegt ~3 min nach Ende des Scans vor.
  * Je Termin 40 Streifen (Chunks) von Süd nach Nord plus Trailer, einzeln ladbar
    (`product.open(entry=…)`). Europa (31,95–72,4° N) = Streifen 32–40: je Termin
    ~220 MB nachts bis ~310 MB tagsüber, 8 parallel in 25–30 s. Die ganze Scheibe
    wären ~2 GB.
  * Die Dateien sind mit FCIDECOMP gepackt → `hdf5plugin`, HDF5_PLUGIN_PATH setzt
    das Cron-Skript.

Drei Fallen, alle im Bild gesehen:
  * netCDF ist NICHT threadsicher: mit dem Thread-Scheduler von dask „NetCDF: HDF
    error" oder Speicherzugriffsfehler. Gelesen wird deshalb synchron.
  * `true_color` getrennt und mit resolution=1000 laden: in EINEM Aufruf mit dem
    500-m-Kanal griff es auf vis_06 in 500 m zurück.
  * Das Enhancement liefert bei hellen Wolken Werte über 1 — vor uint8 klemmen, sonst
    läuft der Kanal über (blaue und rote Flecken).

Aufruf (Python aus ~/mtg-hd/.venv):
  mtg-hd-ingest.py                 neueste fehlende Termine holen, rechnen, ablegen
  mtg-hd-ingest.py --raw DIR       nur rechnen, aus schon geladenen Streifen (Test)
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import math
import os
import re
import shutil
import sys
import time
import warnings
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

warnings.filterwarnings('ignore')

ID = 'mtghd'
STEP = dt.timedelta(minutes=10)
KEEP = dt.timedelta(hours=26)       # wie der übrige Vorrat (MIRROR_SPAN_MS + 2 h)
BACKFILL = 3                        # höchstens so viele fehlende Termine je Lauf
CHUNKS = range(32, 41)              # Europa, gemessen
COLLECTIONS = ('EO:EUM:DAT:0662', 'EO:EUM:DAT:0665')

WORK = Path(os.environ.get('MTG_WORK', '/var/tmp/mtg-hd'))
# Ausgabe unter denselben Pfaden wie in R2. Nicht in public/: /home ist knapp, und
# 26 h Vorrat sind ~1 GB. Für `npm run dev` verlinkt das Cron-Skript public/sat/mtghd
# und public/sat-tiles/mtghd hierher.
OUT = WORK / 'out'
STATE = WORK / 'done.json'

# Europafläche = SATELLITE_AREA in src/config/satellite.ts (Kachelfenster z6 x 27…40,
# y 13…26) — das Bild muss sie EXAKT decken, die Karte spannt es dort auf
EUROPE = dict(west=-28.125, east=45.0, south=31.952162, north=72.395706)
HI_W, LO_W = 2000, 1000             # SATELLITE_MTG_WIDTH, PREVIEW_WIDTH

# Detailkacheln: ein z5-Block, gerechnet in z7 (512-px-Kacheln, 611 m Mercator je Pixel
# ≈ 410 m am Boden bei 48° — das native HRFI-Raster). Darüber wäre nur gestreckt.
TILE = 512
Z_TOP, Z_MAX = 5, 7
BLOCK = dict(x0=16, x1=17, y0=10, y1=11)  # z5: 0–22,5° O, 40,98–55,78° N (y 10 = 55,78–48,92°, y 11 = 48,92–40,98°)

# Überblendung Tag → Nacht über den Sonnenzenitwinkel. Gemessen: darüber werden die
# Echtfarben wegen Sonnenstands- und Rayleigh-Korrektur unbrauchbar (weißes Band am
# Terminator, Farbsäume), das Infrarot ist dort längst gut
SZA_DAY, SZA_NIGHT = 72.0, 84.0

WORLD = 2 * math.pi * 6378137


def log(msg: str) -> None:
    print(f'[{dt.datetime.now():%H:%M:%S}] {msg}', flush=True)


def stamp(t: dt.datetime) -> str:
    return t.strftime('%Y%m%dT%H%MZ')


def merc(lon: float, lat: float) -> tuple[float, float]:
    x = math.radians(lon) * 6378137
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * 6378137
    return x, y


def tile_edges(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """Mercator-Rechteck (minx, miny, maxx, maxy) — wie `tileMerc` im Browser."""
    size = WORLD / 2**z
    return (-WORLD / 2 + x * size, WORLD / 2 - (y + 1) * size, -WORLD / 2 + (x + 1) * size, WORLD / 2 - y * size)


# --- Laden --------------------------------------------------------------------

def datastore():
    import eumdac
    env = dict(
        line.strip().split('=', 1)
        for line in open(os.path.expanduser('~/.config/meteojunkie/eumetsat.env'))
        if '=' in line
    )
    return eumdac.DataStore(eumdac.AccessToken((env['CONSUMER_KEY'], env['CONSUMER_SECRET'])))


def slot(t: dt.datetime) -> dt.datetime:
    """Termin = Beginn des 10-Minuten-Zyklus (Scanbeginn 09:10:07 → 09:10)."""
    t = t.replace(tzinfo=None, second=0, microsecond=0)
    return t - dt.timedelta(minutes=t.minute % 10)


def available(ds) -> dict[dt.datetime, list]:
    """Termine der letzten Stunden, zu denen BEIDE Datensätze vorliegen."""
    now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    found: dict[dt.datetime, dict] = {}
    for cid in COLLECTIONS:
        for p in ds.get_collection(cid).search(dtstart=now - dt.timedelta(hours=2), dtend=now):
            found.setdefault(slot(p.sensing_start), {})[cid] = p
    return {t: [ps[c] for c in COLLECTIONS] for t, ps in found.items() if len(ps) == len(COLLECTIONS)}


def download(products: list, dest: Path) -> int:
    dest.mkdir(parents=True, exist_ok=True)
    jobs = []
    for p in products:
        for e in p.entries:
            m = re.search(r'_(\d{4})\.nc$', e)
            if m and (int(m.group(1)) in CHUNKS or 'TRAIL' in e):
                jobs.append((p, e))

    def get(job) -> int:
        p, e = job
        dst = dest / os.path.basename(e)
        if not dst.exists():
            for attempt in range(3):
                try:
                    with p.open(entry=e) as src, open(f'{dst}.part', 'wb') as f:
                        shutil.copyfileobj(src, f)
                    os.rename(f'{dst}.part', dst)
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    time.sleep(5 * (attempt + 1))
        return dst.stat().st_size

    with ThreadPoolExecutor(8) as ex:
        return sum(ex.map(get, jobs))


# --- Rechnen ------------------------------------------------------------------

def render(raw: Path, t: dt.datetime) -> list[Path]:
    import dask
    import numpy as np
    from PIL import Image
    from pyorbital.astronomy import sun_zenith_angle
    from pyresample import create_area_def
    from satpy import Scene
    from satpy.dataset.dataid import DataQuery
    from satpy.writers import get_enhanced_image

    dask.config.set(scheduler='synchronous')  # netCDF nicht threadsicher, s. Kopf
    t0 = time.time()
    scn = Scene(filenames=sorted(glob.glob(f'{raw}/*BODY*.nc')), reader='fci_l1c_nc')
    q500 = DataQuery(name='vis_06', resolution=500)
    q1k = DataQuery(name='vis_06', resolution=1000)
    qir = DataQuery(name='ir_105', resolution=1000)
    scn.load(['true_color'], resolution=1000)
    scn.load([q500, q1k, qir])
    start = scn[qir].attrs['start_time']

    def picture(box: tuple[float, float, float, float], width: int, height: int, sharpen: bool) -> np.ndarray:
        area = create_area_def('a', 'EPSG:3857', area_extent=box, shape=(height, width))
        # reduce_data=False: das Zuschneiden der Quelle scheiterte beim Detailblock in pyresample
        # (IndexError in get_area_slices) — gradient_search sucht ohnehin nur, was es braucht
        lcl = scn.resample(area, resampler='gradient_search', reduce_data=False)
        lon, lat = area.get_lonlats()
        sza = sun_zenith_angle(start, lon, lat)
        w = np.clip((SZA_NIGHT - sza) / (SZA_NIGHT - SZA_DAY), 0, 1).astype(np.float32)
        day = np.zeros((3, height, width), np.float32)
        if w.max() > 0:
            tc = lcl['true_color']
            if sharpen:
                # Verhältnis 500 m / 1 km DERSELBEN Wellenlänge: der Tiefpass ist gemessen,
                # nicht geschätzt; 0,85 dämpft das Korn (wie render/panSharpen.ts)
                ratio = (lcl[q500] / lcl[q1k].where(lcl[q1k] > 0.5)).clip(0.6, 1.6).fillna(1.0)
                tc = (tc * (1 + 0.85 * (ratio - 1))).assign_attrs(tc.attrs)
            day = np.clip(np.nan_to_num(get_enhanced_image(tc).data.values[:3].astype(np.float32)), 0, 1)
        bt = lcl[qir].values.astype(np.float32)
        # Kalte Wolkenobergrenze hell, warmer Boden dunkel; 290 → 205 K
        night = np.nan_to_num(np.clip((290.0 - bt) / 85.0, 0, 1) ** 0.85)
        rgb = day * w[None] + night[None] * (1 - w[None])
        return (np.moveaxis(rgb, 0, -1) * 255).round().astype(np.uint8)

    s = stamp(t)
    written: list[Path] = []

    def save(img, rel: str, size: int | None = None) -> None:
        path = OUT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        im = Image.fromarray(img)
        if size:
            im = im.resize((size, size), Image.LANCZOS)
        im.save(path, quality=85, optimize=True)
        written.append(path)

    # Europabild (Mercator-Quadrat → quadratisches Bild)
    x0, y0 = merc(EUROPE['west'], EUROPE['south'])
    x1, y1 = merc(EUROPE['east'], EUROPE['north'])
    eu = picture((x0, y0, x1, y1), HI_W, HI_W, sharpen=False)
    save(eu, f'sat/{ID}/hi/{s}.jpg')
    save(eu, f'sat/{ID}/lo/{s}.jpg', LO_W)
    log(f'Europabild {time.time() - t0:.0f} s')

    # Detailblock in z7, daraus z6 und z5 durch Verkleinern
    bx0, bx1, by0, by1 = BLOCK["x0"], BLOCK["x1"], BLOCK["y0"], BLOCK["y1"]
    f = 2 ** (Z_MAX - Z_TOP)
    n = (bx1 - bx0 + 1) * f
    left = tile_edges(Z_TOP, bx0, by0)
    right = tile_edges(Z_TOP, bx1, by1)
    big = picture((left[0], right[1], right[2], left[3]), n * TILE, n * TILE, sharpen=True)
    log(f'Detailblock {n * TILE}² px {time.time() - t0:.0f} s')
    full = Image.fromarray(big)
    for z in range(Z_MAX, Z_TOP - 1, -1):
        k = 2 ** (z - Z_TOP)
        side = (bx1 - bx0 + 1) * k
        level = full if z == Z_MAX else full.resize((side * TILE, side * TILE), Image.LANCZOS)
        a = np.asarray(level)
        for j in range(side):
            for i in range(side):
                save(a[j * TILE:(j + 1) * TILE, i * TILE:(i + 1) * TILE],
                     f'sattile/{ID}/{s}/{z}/{bx0 * k + i}/{by0 * k + j}.jpg')
    log(f'{len(written)} Dateien, {time.time() - t0:.0f} s')
    return written


# --- Zeitliste ------------------------------------------------------------------

def load_state() -> list[str]:
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return []


def write_extent(done: list[str]) -> Path:
    """`sat/mtghd/meta.json` (60 s Cache im Worker, wie alle meta.json) in der Form von TimeExtent: Anfang, Ende, Schritt und
    die Termine dazwischen, die FEHLEN (Laptop aus) — sonst stünde dort ein Bild,
    das nie kommt."""
    times = sorted(dt.datetime.strptime(s, '%Y%m%dT%H%MZ') for s in done)
    ms = lambda d: int(d.replace(tzinfo=dt.timezone.utc).timestamp() * 1000)
    have = set(times)
    missing, t = [], times[0]
    while t < times[-1]:
        if t not in have:
            missing.append(ms(t))
        t += STEP
    path = OUT / f'sat/{ID}/meta.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({'start': ms(times[0]), 'end': ms(times[-1]), 'stepMs': 600_000, 'missing': missing}))
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', help='nur rechnen, aus diesem Verzeichnis mit Streifen')
    args = ap.parse_args()

    if args.raw:
        t = dt.datetime.strptime(re.search(r'(\d{12})', args.raw).group(1), '%Y%m%d%H%M')
        render(Path(args.raw), slot(t))
        return

    now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    done = [s for s in load_state() if dt.datetime.strptime(s, '%Y%m%dT%H%MZ') > now - KEEP]
    ds = datastore()
    todo = sorted((t for t in available(ds) if stamp(t) not in done), reverse=True)[:BACKFILL]
    (WORK / 'new.txt').unlink(missing_ok=True)
    if not todo:
        log('nichts Neues')
        write_extent(done) if done else None
        return
    produced: list[Path] = []
    for t in todo:
        raw = WORK / f'raw-{t:%Y%m%d%H%M}'
        t0 = time.time()
        size = download(available(ds)[t], raw)
        log(f'{stamp(t)}: {size / 1e6:.0f} MB in {time.time() - t0:.0f} s')
        produced += render(raw, t)
        shutil.rmtree(raw, ignore_errors=True)
        done.append(stamp(t))
        STATE.write_text(json.dumps(sorted(set(done))))
    write_extent(done)
    # Für das Hochladen: welche Termine neu sind (Cron-Skript liest das)
    (WORK / 'new.txt').write_text('\n'.join(stamp(t) for t in todo))


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
