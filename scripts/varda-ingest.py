#!/usr/bin/env python3
"""MeteoSwiss Varda-single-1.0 (Anemoi) → Wertebilder für die Modellkarten.

Anders als die übrigen Modellkarten-Ingests holt dieses Skript keine fertige
Vorhersage, sondern RECHNET sie: ein datengetriebenes Modell (Graph
Transformer auf einem Stretched Grid, global 31 km, über den Alpen 1 km) auf
der GPU des Laptops. Deshalb läuft es nicht im Deploy (GitHub Actions hat
keine GPU), sondern per systemd-Timer lokal und lädt danach selbst nach R2
(`scripts/upload-data.sh nwp/varda` — der Deploy fasst das Verzeichnis nicht an).

Gemessen 2026-11-02 (RTX 5090 Laptop, 24 GB):
  * Startwerte: MeteoSwiss KENDA-CH1 (data.geo.admin.ch, STAC) erscheint 2 bis
    2¾ h nach dem Termin, ECMWF Open Data global (fällt auf die Vorhersage des
    vorigen Laufs zurück, wenn die Analyse noch fehlt). Varda braucht zwei
    Analysen im Abstand von 6 h → Läufe 00/06/12/18 UTC, frühestens +3 h.
  * Vorhersager 6-stündlich bis +120 h: 3,6 min, davon ~1 min GPU, Spitze
    18,5 GB Grafikspeicher. Stündlicher Downscaler 24 h: 2,6 min, 18,2 GB.
  * Das 1-km-Gebiet ist das ICON-CH1/KENDA-Gebiet: 1.147.980 Punkte,
    42,0–50,5° N / 0,8° W–17,7° O, ganz Österreich drin. Die Punkte liegen auf
    dem unstrukturierten ICON-Gitter und stehen NICHT im GRIB — die
    Koordinaten kommen aus dem Checkpoint.
  * Ungefiltert schreibt der Downscaler 67 Felder je Stunde (~160 MB GRIB),
    über 120 h ~20 GB. Er schreibt deshalb nur die Felder, die die Karten
    brauchen, und jeder Schritt wird nach dem Lesen gelöscht.

Drei Abweichungen von den Vorgaben im Modell-Repository, alle nötig:
PyTorch für CUDA 12.8 statt 12.4 (die RTX 5090 ist sm_120), der Ein-GPU-Runner
statt `runner.parallel` (mit einer Karte bricht die Prozessgruppe ab) und
`libgfortran.so.5` für ECMWFs MIR (`apt install libgfortran5`, sonst über
VARDA_LD_LIBRARY_PATH).

Umgebung:
  VARDA_HOME   Modell-Repository samt .venv-fc / .venv-ds (Vorgabe ~/varda-test)
  VARDA_WORK   Arbeitsverzeichnis für GRIB und Caches (Vorgabe /var/tmp/varda-run
               — liegt auf /, die Zwischendateien sind mehrere GB)
  VARDA_LD_LIBRARY_PATH   optional, Verzeichnis mit libgfortran.so.5

Aufruf (aus dem Repo-Wurzelverzeichnis, mit dem Python aus VARDA_HOME/.venv-fc):
  python scripts/varda-ingest.py               neuesten Lauf rechnen und ablegen
  python scripts/varda-ingest.py --latest      nur die Kennung des neuesten Laufs
  python scripts/varda-ingest.py --run 2026110206 --lead 24
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from nwp_common import OUT_ROOT, ingest, run_id

MODEL = 'varda'
HOME = Path(os.environ.get('VARDA_HOME', Path.home() / 'varda-test'))
WORK = Path(os.environ.get('VARDA_WORK', '/var/tmp/varda-run'))
FC = 'varda-forecaster-det-sgm'
DS = 'varda-temporal-downscaler-det-sgm'

STAC = 'https://data.geo.admin.ch/api/stac/v1/search'
KENDA = 'ch.meteoschweiz.ogd-analysis-kenda-ch1'

# Regelmäßiges Zielraster 0,01° (~1 km) über dem ganzen 1-km-Gebiet, von Süd
# nach Nord wie ICON. Feiner wäre sinnlos (das Modellgitter ist ~1 km), gröber
# nähme gerade das weg, wofür das Modell da ist.
GRID = {'ni': 1851, 'nj': 844, 'lon0': -0.8, 'lat0': 42.05, 'dlon': 0.01, 'dlat': 0.01, 'global': False}
# Weiter als ~1,5 km vom nächsten Modellpunkt ist außerhalb des Gebiets
MAX_DIST_DEG = 0.015

# anemoi-Name → (GRIB-shortName, Level) für den Filter der Downscaler-Ausgabe
# und das Lesen. Alles Übrige (Feuchte und Wind auf weiteren Flächen …)
# braucht keine Karte.
FIELDS = {
    '2t': ('T_2M', None, 't2m'),
    '2d': ('TD_2M', None, 'td2m'),
    '10u': ('U_10M', None, 'u10'),
    '10v': ('V_10M', None, 'v10'),
    'msl': ('PMSL', None, 'msl'),
    'tp': ('TOT_PREC', None, 'tp'),
    't_850': ('T', 850, 't850'),
    'u_300': ('U', 300, 'u300'),
    'v_300': ('V', 300, 'v300'),
    'z_500': ('FI', 500, 'gh500'),
    'z_300': ('FI', 300, 'gh300'),
    'z_1000': ('FI', 1000, 'gh1000'),
    'q_700': ('QV', 700, 'q700'),
    't_700': ('T', 700, 't700'),
    'u_850': ('U', 850, 'u850'),
    'v_850': ('V', 850, 'v850'),
    'u_700': ('U', 700, 'u700'),
    'v_700': ('V', 700, 'v700'),
    # Nur für die Nullgradgrenze (500 hPa liegt selbst im Hochsommer über ihr)
    't_1000': ('T', 1000, 't1000'),
    't_925': ('T', 925, 't925'),
    't_500': ('T', 500, 't500'),
    'z_925': ('FI', 925, 'gh925'),
    'z_850': ('FI', 850, 'gh850'),
    'z_700': ('FI', 700, 'gh700'),
}
G = 9.80665
T0 = 273.15
# Von unten nach oben. 600 hPa gibt die Ausgabe nicht her (gemessen 2026-11-09: 12 Flächen
# 50–1000 hPa ohne 600), zwischen 700 und 500 hPa wird also über ~2,5 km interpoliert
ZERO_LEVELS = (1000, 925, 850, 700, 500)

# Was Varda führt — Bewölkung, Böen, CAPE, Schnee, Wellen und die Vertikalbewegung gibt
# es nicht: die Metadaten des Checkpoints nennen `w_*` und 600 hPa, das sind die
# Trainingsdaten, ausgegeben werden nur FI, QV, T, U, V
VARIABLES = {
    't2m', 't850', 't700', 'msl', 'precip', 'precipsum', 'wind10', 'uv10',
    'wind850', 'uv850', 'wind700', 'uv700', 'wind300', 'uv300',
    'gh500', 'gh300', 'reltop', 'td2m', 'rh700', 'hzerocl',
}
# precip/precipsum fehlen bei +0 h (kein Intervall), das ist kein Fehler
OPTIONAL = {'precip', 'precipsum'}


def log(msg: str) -> None:
    print(f'[{datetime.now():%H:%M:%S}] {msg}', flush=True)


# --- Lauf bestimmen --------------------------------------------------------

def kenda_times() -> set[datetime]:
    body = json.dumps({
        'collections': [KENDA], 'forecast:variable': 'P', 'forecast:horizon': 'P0DT00H00M00S',
        'forecast:perturbed': False, 'limit': 100,
    }).encode()
    req = urllib.request.Request(STAC, data=body, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        feats = json.load(r)['features']
    out = set()
    for f in feats:
        t = f['properties']['forecast:reference_datetime'].split('/')[0].removesuffix('Z')
        out.add(datetime.fromisoformat(t).replace(tzinfo=timezone.utc))
    return out


def latest_run() -> datetime:
    """Jüngster 6-h-Termin, zu dem t UND t−6 h als KENDA-Analyse vorliegen."""
    have = kenda_times()
    ok = [t for t in have if t.hour % 6 == 0 and t - timedelta(hours=6) in have]
    if not ok:
        raise SystemExit('keine zwei KENDA-Analysen im 6-h-Abstand gefunden')
    return max(ok)


# --- Rechnen ---------------------------------------------------------------

def cosmo_definitions() -> None:
    """ecCodes mit den COSMO/ICON-Definitionen — ohne sie heißen die Felder
    nicht T_2M, PMSL …, und das Lesen fände nichts. Muss vor dem ersten
    `import eccodes` stehen; gilt auch für die Unterprozesse."""
    from eccodes_cosmo_resources import get_definitions_path

    os.environ['ECCODES_DEFINITION_PATH'] = str(get_definitions_path())
    os.environ['ECCODES_VERSION_CHECK_OFF'] = '1'


def env() -> dict:
    e = dict(os.environ)
    e.update({
        'PYTORCH_CUDA_ALLOC_CONF': 'expandable_segments:True',
        'ANEMOI_INFERENCE_NUM_CHUNKS_MAPPER': '16',
        'PYTHONOPTIMIZE': '1',
    })
    if lib := os.environ.get('VARDA_LD_LIBRARY_PATH'):
        e['LD_LIBRARY_PATH'] = lib + (':' + e['LD_LIBRARY_PATH'] if e.get('LD_LIBRARY_PATH') else '')
    return e


def prepare_work() -> None:
    """Arbeitsverzeichnis: Modelle und Vorlagen verlinkt, Ausgabe und Caches echt.

    Die Konfigurationen des Modell-Repositorys nennen ihre Pfade RELATIV
    (`outputs/`, `cache/kenda`, `templates/`) — so bleiben sie unverändert,
    und die GB an Zwischendateien landen auf /, nicht auf /home.
    """
    WORK.mkdir(parents=True, exist_ok=True)
    for name in (FC, DS, 'templates'):
        link = WORK / name
        if not link.exists():
            link.symlink_to(HOME / name)
    shutil.rmtree(WORK / 'outputs', ignore_errors=True)
    (WORK / 'outputs').mkdir()


def downscaler_config(lead_h: int) -> Path:
    """Downscaler-Konfiguration mit Ein-GPU-Runner und Feldfilter erzeugen."""
    import yaml

    src = HOME / DS / 'configs' / 'inference'
    orig = src / 'inference_opendata.orig.yaml'
    cfg = yaml.safe_load((orig if orig.exists() else src / 'inference_opendata.yaml').read_text())
    cfg['runner'] = 'temporal_downscaler'
    cfg['lead_time'] = f'{lead_h}h'
    grib = cfg['output']['tee']['outputs'][0]['grib']
    grib['variables'] = list(FIELDS)
    path = WORK / 'downscaler.yaml'
    path.write_text(yaml.safe_dump(cfg, sort_keys=False))
    return path


def run_inference(run: datetime, lead_h: int) -> None:
    e = env()
    date = run.strftime('%Y-%m-%dT%H:%M:%S')
    t0 = time.time()
    log(f'Vorhersager +{lead_h} h ab {date}')
    subprocess.run(
        [HOME / '.venv-fc' / 'bin' / 'anemoi-inference', 'run',
         f'{FC}/configs/inference/inference_opendata.yaml', f'date={date}', f'lead_time={lead_h}h'],
        cwd=WORK, env=e, check=True,
    )
    log(f'Vorhersager fertig nach {time.time() - t0:.0f} s — Downscaler')
    t1 = time.time()
    subprocess.run(
        [HOME / '.venv-ds' / 'bin' / 'anemoi-inference', 'run', downscaler_config(lead_h), f'date={date}'],
        cwd=WORK, env=e, check=True,
    )
    log(f'Downscaler fertig nach {time.time() - t1:.0f} s')
    # Die globalen Felder und die 6-stündliche Ausgabe braucht niemand mehr
    for p in (WORK / 'outputs').glob('*.grib'):
        if not p.name.startswith('varda-single_'):
            p.unlink()


# --- Umrechnen auf das regelmäßige Gitter ----------------------------------

def lam_coords():
    import numpy as np

    cache = HOME / 'lam_coords.npz'
    if cache.exists():
        c = np.load(cache)
        return c['lat'], c['lon']
    from anemoi.utils.checkpoints import load_metadata

    _, arrays = load_metadata(str(HOME / FC / 'model.ckpt'), supporting_arrays=True)
    d = arrays['data']
    m = d['lam_0/cutout_mask']
    lat, lon = d['source0/latitudes'][m], d['source0/longitudes'][m]
    lon = np.where(lon > 180, lon - 360, lon)
    np.savez(cache, lat=lat, lon=lon)
    return lat, lon


def regrid_weights():
    """Lineare Interpolation über eine Delaunay-Triangulierung, einmal gerechnet.

    Barycentrische Gewichte je Zielpunkt (drei Modellpunkte); außerhalb des
    Gebiets −1. Gemessen ~1 min beim ersten Mal, danach aus dem Cache.
    """
    import numpy as np

    cache = HOME / 'regrid_0p01.npz'
    if cache.exists():
        c = np.load(cache)
        return c['idx'], c['w']
    from scipy.spatial import Delaunay, cKDTree

    log('Interpolationsgewichte berechnen (einmalig)')
    lat, lon = lam_coords()
    k = np.cos(np.radians(46.0))
    src = np.c_[lon * k, lat]
    glon = GRID['lon0'] + np.arange(GRID['ni']) * GRID['dlon']
    glat = GRID['lat0'] + np.arange(GRID['nj']) * GRID['dlat']
    tlon, tlat = np.meshgrid(glon, glat)
    tgt = np.c_[tlon.ravel() * k, tlat.ravel()]
    tri = Delaunay(src)
    simplex = tri.find_simplex(tgt)
    trans = tri.transform[simplex]
    bary = np.einsum('nij,nj->ni', trans[:, :2], tgt - trans[:, 2])
    w = np.c_[bary, 1 - bary.sum(axis=1)].astype(np.float32)
    idx = tri.simplices[simplex].astype(np.int32)
    dist, _ = cKDTree(src).query(tgt)
    outside = (simplex < 0) | (dist > MAX_DIST_DEG)
    idx[outside] = -1
    np.savez(cache, idx=idx, w=w)
    log(f'Gewichte fertig: {(~outside).sum()} von {outside.size} Zielpunkten im Gebiet')
    return idx, w


def zero_level(t: list, h: list):
    """Höhe der 0-°C-Fläche (m) aus Temperatur (K) und Höhe je Druckfläche, von unten nach oben.

    Linear in der Höhe zwischen den Flächen. Bei einer Inversion gilt der OBERSTE
    Durchgang, wie bei HZEROCL von ICON. Friert die ganze Säule, steht dort die Höhe der
    untersten Fläche (die Skala zeigt dann ihre tiefste Stufe), ist auch 500 hPa noch
    über 0 °C, gibt es keinen Wert. Über Gebirge kann der Durchgang unter dem Gelände
    liegen: die Druckflächen sind dort extrapoliert, wie bei jedem Modell.
    """
    import numpy as np

    res = np.where(t[0] < T0, h[0], np.nan)
    with np.errstate(invalid='ignore', divide='ignore'):
        for tl, tu, hl, hu in zip(t, t[1:], h, h[1:]):
            cross = (tl >= T0) & (tu < T0)
            res = np.where(cross, hl + (tl - T0) / (tl - tu) * (hu - hl), res)
    return res.astype(np.float32)


def read_step(path: Path, idx, w) -> dict:
    import eccodes
    import numpy as np

    want = {(sn, lev): name for sn, lev, name in FIELDS.values()}
    raw = {}
    with open(path, 'rb') as fh:
        while (h := eccodes.codes_grib_new_from_file(fh)) is not None:
            try:
                sn = eccodes.codes_get(h, 'shortName')
                lev = eccodes.codes_get(h, 'level') if eccodes.codes_get(h, 'typeOfLevel') == 'isobaricInhPa' else None
                name = want.get((sn, lev))
                if name:
                    raw[name] = eccodes.codes_get_values(h)
            finally:
                eccodes.codes_release(h)
    inside = idx[:, 0] >= 0
    safe = np.where(inside[:, None], idx, 0)
    out: dict = {'_grid': dict(GRID)}
    for name, v in raw.items():
        g = (v[safe] * w).sum(axis=1)
        g[~inside] = np.nan
        out[name] = g.reshape(GRID['nj'], GRID['ni']).astype(np.float64 if name == 'tp' else np.float32)
    for k in ('gh500', 'gh300', 'gh1000', 'gh925', 'gh850', 'gh700'):
        if k in out:
            out[k] = out[k] / G
    if all(f't{p}' in out and f'gh{p}' in out for p in ZERO_LEVELS):
        out['hzerocl'] = zero_level([out[f't{p}'] for p in ZERO_LEVELS], [out[f'gh{p}'] for p in ZERO_LEVELS])
    # Nur Zwischengrößen: ein Teil der 1-km-Felder je Stunde weniger im Speicher
    for k in ('t1000', 't925', 't500', 'gh925', 'gh850', 'gh700'):
        out.pop(k, None)
    if 'q700' in out and 't700' in out:
        # Relative Feuchte aus spezifischer Feuchte und Temperatur (über Wasser,
        # Bolton 1980) — Varda führt sie nicht direkt
        q, t = out.pop('q700'), out['t700']
        e = q * 70000.0 / (0.622 + 0.378 * q)
        es = 611.2 * np.exp(17.67 * (t - 273.15) / (t - 29.65))
        out['rh700'] = (100.0 * e / es).astype(np.float32)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--latest', action='store_true', help='nur die Kennung des neuesten Laufs ausgeben')
    ap.add_argument('--run', help='Lauf YYYYMMDDHH statt des neuesten')
    ap.add_argument('--lead', type=int, default=120, help='Vorhersagelänge in Stunden (Vielfaches von 6)')
    ap.add_argument('--skip-inference', action='store_true', help='vorhandene GRIBs in VARDA_WORK verarbeiten')
    args = ap.parse_args()
    cosmo_definitions()

    run = (datetime.strptime(args.run, '%Y%m%d%H').replace(tzinfo=timezone.utc)
           if args.run else latest_run())
    rid = run_id(run)
    if args.latest:
        print(rid)
        return
    if args.lead % 6:
        raise SystemExit('--lead muss ein Vielfaches von 6 sein')
    meta = OUT_ROOT / MODEL / 'meta.json'
    old = json.loads(meta.read_text()) if meta.exists() else {}
    # Auch die Länge vergleichen: ein Probelauf mit --lead 12 ist nicht „fertig"
    if old.get('runId') == rid and old.get('stepCount') == args.lead + 1 and not args.run:
        log(f'Varda Lauf {rid} liegt schon vor — nichts zu tun')
        return

    t0 = time.time()
    if not args.skip_inference:
        prepare_work()
        run_inference(run, args.lead)
    idx, w = regrid_weights()
    stamp = f'{rid}00'

    def fetch_step(step: int, _pool: ThreadPoolExecutor) -> dict:
        path = WORK / 'outputs' / f'varda-single_{stamp}_{step}.grib'
        f = read_step(path, idx, w)
        path.unlink()  # sofort weg: 120 Stunden GRIB wären mehrere GB
        if step == 0 and 'tp' not in f and 't2m' in f:
            # Bei +0 schreibt der Downscaler keine Summe (gemessen) — sie ist
            # dort per Definition 0; ohne sie fehlte die Rate der ersten Stunde
            import numpy as np
            f['tp'] = np.where(np.isfinite(f['t2m']), 0.0, np.nan)
        return f

    steps = list(range(0, args.lead + 1))
    ingest(MODEL, 'Varda', run, steps, fetch_step, step_window=3, encode_workers=6,
           only=VARIABLES, optional=OPTIONAL)
    # Caches der Startwerte: der nächste Lauf braucht andere Termine
    for d in ('cache', 'outputs'):
        shutil.rmtree(WORK / d, ignore_errors=True)
    log(f'Varda Lauf {rid} fertig nach {time.time() - t0:.0f} s')


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as e:
        print(f'anemoi-inference ist gescheitert (Exit {e.returncode})', file=sys.stderr)
        sys.exit(1)
