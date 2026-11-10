#!/usr/bin/env python3
"""GeoSphere AROME 1 km (Data Hub, `nwp-v2-1h-1km`) → Wertebilder für „Alpen 3D".

Nur die Niederschlagsgrößen: Niederschlag je Stunde, Summe, Neuschnee und die
Summe mit Phase (`precipphase`, Rechnung in `nwp_common.phase_step`) — das ist, wofür
dieses Modell hier steht (seit 2026-11-10, auf Wunsch).

Gemessen 2026-11-10:
  * Datensatz `nwp-v2-1h-1km` (C-LAEF-AA, „AROME 1 km"), offen und ohne Schlüssel,
    Läufe alle 3 h, 0–60 h stündlich, regelmäßiges Gitter 0,0135° × 0,009°,
    43,0–51,5° N / 5,03–22,57° O. Der 2,5-km-Vorgänger `nwp-v1-1h-2500m` endet am
    04.11.2026 (letzter Lauf).
  * `tp` und `sf` gelten für die LETZTE STUNDE (nicht seit Init) — hier aufsummiert,
    damit die gemeinsame Pipeline sie wie ICON behandelt. kg/m² = mm.
  * `snowlmt` ist laut Beschreibung „height above ground", tatsächlich aber über NN:
    gegen ICON-D2 (über NN) zur selben Zeit hängt die Differenz NICHT von der
    Geländehöhe ab (Steigung −0,04 über 0–3000 m, Median-Differenz −50…+80 m).
    Anders als bei ICON-D2 überall gesetzt.
  * Je Abfrage höchstens 10 Mio. Datenpunkte → 5 Stunden × 3 Größen über das Gebiet
    von „Alpen 3D" (622 × 937), ~6 MB NetCDF, 2–9 s; ein Lauf = 13 Abfragen. Grenze
    240 Abfragen je Stunde und 5 je Sekunde.
  * Der neueste Lauf lag um 16 UTC bei 09 UTC — die Bereitstellung dauert länger
    als bei ICON-D2.

Aufruf (aus dem Repo-Wurzelverzeichnis):
  python3 scripts/arome-ingest.py              neuesten Lauf holen
  python3 scripts/arome-ingest.py --latest     nur die Lauf-Kennung ausgeben
  python3 scripts/arome-ingest.py --run 2026111009
"""

from __future__ import annotations

import argparse
import io
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

from nwp_common import ingest, run_id

MODEL = 'arome-at'
LABEL = 'AROME 1 km'
API = 'https://dataset.api.hub.geosphere.at/v1/grid/forecast/nwp-v2-1h-1km'
# lat_s, lon_w, lat_n, lon_e — das Gebiet von „Alpen 3D" (`PHASE_BOX`), im Westen auf
# den Rand des Datensatzes (5,03° O) gekappt
BBOX = (43.8, 5.05, 49.4, 17.7)
PARAMS = ('tp', 'sf', 'snowlmt')
STEPS = list(range(0, 61))
CHUNK_H = 5
UA = {'User-Agent': 'meteo-workbench ingest'}


def get(url: str, timeout: float = 120, tries: int = 5) -> bytes:
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if isinstance(e, urllib.error.HTTPError) and e.code not in (429, 500, 502, 503, 504):
                raise RuntimeError(f'HTTP {e.code}: {e.read()[:300]!r}') from e
            if attempt == tries - 1:
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError('unreachable')


def reftimes() -> list[datetime]:
    meta = json.loads(get(f'{API}/metadata', timeout=30))
    return sorted(
        (datetime.fromisoformat(t).astimezone(timezone.utc) for t in meta['available_forecast_reftimes']),
        reverse=True,
    )


def fetch_run(run: datetime, steps: list[int]):
    """Alle Schritte eines Laufs als Felder (T × NJ × NI) plus Raster."""
    import netCDF4
    import numpy as np

    # `forecast_offset` zählt die Läufe rückwärts ab dem neuesten
    runs = reftimes()
    if run not in runs:
        raise RuntimeError(f'Lauf {run_id(run)} nicht (mehr) im Datensatz: {[run_id(r) for r in runs]}')
    offset = runs.index(run)
    out = {p: [] for p in PARAMS}
    grid = None
    for k in range(0, len(steps), CHUNK_H):
        part = steps[k : k + CHUNK_H]
        t0, t1 = run + timedelta(hours=part[0]), run + timedelta(hours=part[-1])
        url = (
            f'{API}?parameters={",".join(PARAMS)}&bbox={",".join(map(str, BBOX))}&output_format=netcdf'
            f'&forecast_offset={offset}&start={t0:%Y-%m-%dT%H:%M}&end={t1:%Y-%m-%dT%H:%M}'
        )
        ds = netCDF4.Dataset('arome.nc', memory=get(url))
        try:
            lead = np.asarray(ds['leadtime'][:], float)
            if list(np.round(lead).astype(int)) != part:
                raise RuntimeError(f'Schritte {lead} statt {part} — Lauf gewechselt?')
            lat = np.asarray(ds['lat'][:], float)
            lon = np.asarray(ds['lon'][:], float)
            g = {
                'ni': len(lon), 'nj': len(lat),
                'lon0': round(float(lon[0]), 6), 'lat0': round(float(lat[0]), 6),
                'dlon': round(float(lon[1] - lon[0]), 6), 'dlat': round(float(lat[1] - lat[0]), 6),
                'global': False,
            }
            if grid is None:
                grid = g
            elif g != grid:
                raise RuntimeError(f'Raster wechselt: {g} statt {grid}')
            for p in PARAMS:
                out[p].append(np.ma.filled(ds[p][:].astype(np.float32), np.nan))
        finally:
            ds.close()
        print(f'  +{part[0]}…+{part[-1]} h geholt', flush=True)
        time.sleep(0.3)  # 5 Abfragen je Sekunde erlaubt
    return {p: np.concatenate(v) for p, v in out.items()}, grid


def main() -> None:
    import numpy as np

    ap = argparse.ArgumentParser()
    ap.add_argument('--latest', action='store_true', help='nur die Kennung des neuesten Laufs ausgeben')
    ap.add_argument('--run', help='Lauf YYYYMMDDHH statt des neuesten')
    ap.add_argument('--steps', type=int, help='nur die ersten N Schritte (Entwicklung)')
    args = ap.parse_args()

    if args.run:
        run = datetime.strptime(args.run, '%Y%m%d%H').replace(tzinfo=timezone.utc)
    else:
        run = reftimes()[0]
    if args.latest:
        print(run_id(run))
        return
    steps = STEPS[: args.steps] if args.steps else STEPS

    data, grid = fetch_run(run, steps)
    # Je Stunde → seit Laufbeginn (wie `tot_prec` bei ICON); fehlende Werte zählen 0,
    # bleiben aber fehlend, damit der Modellrand durchsichtig bleibt
    cum = {}
    for p in ('tp', 'sf'):
        v = data[p]
        c = np.cumsum(np.nan_to_num(v), axis=0)
        cum[p] = np.where(np.isnan(v), np.nan, c)

    def fetch_step(step: int, _pool):
        i = steps.index(step)
        return {'_grid': grid, 'tp': cum['tp'][i], 'sf': cum['sf'][i], 'snowlmt': data['snowlmt'][i]}

    ingest(
        MODEL, LABEL, run, steps, fetch_step,
        only={'precip', 'precipsum', 'newsnow', 'precipphase'},
        optional=set(),
    )


if __name__ == '__main__':
    main()
