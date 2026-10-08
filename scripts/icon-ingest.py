#!/usr/bin/env python3
"""DWD ICON-D2 / ICON-EU (Open Data) → Wertebilder für die Modellkarten.

Gleiche Pipeline wie ECMWF (`nwp_common.py`), andere Quelle: opendata.dwd.de
liefert EINE GRIB2-Datei je Größe × Schritt (× Level), bz2-gepackt, ohne
CORS — deshalb Ingest im Deploy. Lizenz GeoNutzV (kommerziell mit
Quellenangabe erlaubt).

Gemessen 2026-10-05:
  * ICON-D2: regelmäßiges Gitter 0,02° (~2,2 km), 1215×746, 43,18–58,08° N /
    3,94° W–20,34° O — ganz Österreich und die Alpen. Rund 150.000 Randpunkte
    liegen außerhalb des Modellgebiets (fehlend). Läufe alle 3 h, 0–48 h
    stündlich, komplett ~1 h 20 min nach Init.
  * ICON-EU: 0,0625° (~7 km), 1377×657, 29,5–70,5° N / 23,5° W–62,5° O.
    00/06/12/18 UTC bis +120 h (stündlich bis 78, dann 3 h), komplett
    ~3 h 40 min nach Init. Die Zwischenläufe (03/09/…) reichen nur ~30 h und
    werden NICHT genommen — dieselbe Begründung wie die ECMWF-06/18-Läufe.
  * Abtastung SÜD → NORD (`jScansPositively`), anders als ECMWF; das Raster
    kommt deshalb aus der Nachricht (`decode_grib`).
  * Böe `vmax_10m`: Maximum der LETZTEN STUNDE vor dem Termin — auch bei
    ICON-EU nach +78 h, wo die Schritte 3 h auseinanderliegen (stepRange
    `80-81`). Das Intervall steht je Schritt in meta.json.
  * Niederschlag `tot_prec` seit Init aufsummiert (kg/m² = mm).
  * Durchsatz 22–26 MB/s bei 8 parallelen Abrufen, 0 Fehler in 216 Abrufen.
  * Vorhaltung nur ~24 h: jedes Stundenverzeichnis wird vom nächsten Lauf
    dieser Stunde überschrieben.

Aufruf (aus dem Repo-Wurzelverzeichnis):
  python3 scripts/icon-ingest.py icon-d2            neuesten vollständigen Lauf holen
  python3 scripts/icon-ingest.py icon-eu --latest   nur die Lauf-Kennung ausgeben
  python3 scripts/icon-ingest.py icon-d2 --run 2026100509
"""

from __future__ import annotations

import argparse
import bz2
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from nwp_common import Missing, decode_grib, http_get, ingest, run_id, url_exists

BASE = 'https://opendata.dwd.de/weather/nwp'

MODELS = {
    'icon-d2': {
        'label': 'ICON-D2',
        'cycle_h': 3,
        'steps': list(range(0, 49)),
        # Dateiname: …_single-level_<run>_<SSS>_2d_<var> bzw. …_pressure-level_<run>_<SSS>_<lev>_<var>
        'prefix': 'icon-d2_germany_regular-lat-lon',
        'single': lambda run, s, v: f'single-level_{run}_{s:03d}_2d_{v}',
        'level': lambda run, s, lev, v: f'pressure-level_{run}_{s:03d}_{lev}_{v}',
    },
    'icon-eu': {
        'label': 'ICON-EU',
        'cycle_h': 6,
        'steps': list(range(0, 79)) + list(range(81, 121, 3)),
        # Variablenname im Dateinamen GROSS
        'prefix': 'icon-eu_europe_regular-lat-lon',
        'single': lambda run, s, v: f'single-level_{run}_{s:03d}_{v.upper()}',
        'level': lambda run, s, lev, v: f'pressure-level_{run}_{s:03d}_{lev}_{v.upper()}',
    },
}

# Verzeichnisname (DWD-Größe), Level, einheitlicher Name aus nwp_common
FIELDS = [
    ('t_2m', None, 't2m'),
    ('t', '850', 't850'),
    ('pmsl', None, 'msl'),
    ('tot_prec', None, 'tp'),
    ('u_10m', None, 'u10'),
    ('v_10m', None, 'v10'),
    ('vmax_10m', None, 'gust'),
    ('fi', '500', 'gh500'),
    ('clct', None, 'tcc'),
    # Wolkenschichten — nur ICON hat sie offen (ECMWF Open Data nur `tcc`)
    ('clch', None, 'clch'),
    ('clcm', None, 'clcm'),
    ('clcl', None, 'clcl'),
]

G = 9.80665  # Geopotential (m²/s²) → geopotentielle Höhe (m)


def field_url(model: str, run: datetime, step: int, var: str, lev: str | None) -> str:
    m = MODELS[model]
    rid = run_id(run)
    name = m['level'](rid, step, lev, var) if lev else m['single'](rid, step, var)
    return f"{BASE}/{model}/grib/{run:%H}/{var}/{m['prefix']}_{name}.grib2.bz2"


def run_complete(model: str, run: datetime) -> bool:
    """Vollständig = der letzte Schritt von T2m liegt da (die Dateien erscheinen der Reihe nach)."""
    return url_exists(field_url(model, run, MODELS[model]['steps'][-1], 't_2m', None))


def latest_run(model: str, now: datetime) -> datetime:
    cyc = MODELS[model]['cycle_h']
    base = now.replace(minute=0, second=0, microsecond=0)
    base = base.replace(hour=base.hour - base.hour % cyc)
    # Weiter als 24 h zurück gibt es nichts: das Stundenverzeichnis wird überschrieben
    for i in range(24 // cyc + 1):
        run = base - timedelta(hours=cyc * i)
        if run_complete(model, run):
            return run
    raise SystemExit(f'kein vollständiger {MODELS[model]["label"]}-Lauf in den letzten 24 h gefunden')


def fetch_step(model: str, run: datetime, step: int, pool: ThreadPoolExecutor) -> dict:
    import numpy as np

    futures = {
        name: pool.submit(http_get, field_url(model, run, step, var, lev))
        for var, lev, name in FIELDS
    }
    out: dict = {}
    for name, fut in futures.items():
        try:
            vals, grid, hours = decode_grib(bz2.decompress(fut.result()))
        except Missing:
            continue
        out['_grid'] = grid
        if name == 'tp':
            out[name] = vals  # kg/m² = mm, doppelt genau (wird differenziert)
        elif name == 'gh500':
            out[name] = (vals / G).astype(np.float32)
        else:
            out[name] = vals.astype(np.float32)
        if name == 'gust':
            out['gust_hours'] = hours
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('model', choices=sorted(MODELS))
    ap.add_argument('--latest', action='store_true', help='nur die Kennung des neuesten Laufs ausgeben')
    ap.add_argument('--run', help='Lauf YYYYMMDDHH statt des neuesten')
    ap.add_argument('--steps', type=int, help='nur die ersten N Schritte (Entwicklung)')
    args = ap.parse_args()

    m = MODELS[args.model]
    if args.run:
        run = datetime.strptime(args.run, '%Y%m%d%H').replace(tzinfo=timezone.utc)
    else:
        run = latest_run(args.model, datetime.now(timezone.utc))
    if args.latest:
        print(run_id(run))
        return
    steps = m['steps'][: args.steps] if args.steps else m['steps']
    # DWD verträgt die Last (gemessen), deshalb ein weiteres Fenster als bei ECMWF
    ingest(args.model, m['label'], run, steps, lambda s, pool: fetch_step(args.model, run, s, pool),
           step_window=4, field_workers=16)


if __name__ == '__main__':
    main()
