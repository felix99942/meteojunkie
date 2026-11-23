#!/usr/bin/env python3
"""GeoSphere C-LAEF 1 km (Data Hub, `nwp-v2-1h-1km`) → Wertebilder für die Modellkarten.

C-LAEF-AA ist der Nachfolger von AROME Austria (2,5 km, endete am 04.11.2026). Die
Modell-ID bleibt `arome-at` — sie steht in den Pfaden in R2 und im Actions-Cache.

Seit 2026-11-23 alle Bodengrößen über den ALPENRAUM (= Ansicht „Alpen", vorher nur
die Niederschlagsgrößen über „Alpen 3D"): T2m, Taupunkt (aus rF), MSL, Wind 10 m,
Böen, Bewölkung, CAPE, Niederschlag/Summe, Neuschnee, Regen/Schnee-Summe.

NICHT das ganze Gebiet des Datensatzes (43–51,5° N / 5–22,6° O, erste Fassung):
das sind zwei Abfragen je Schritt, ~750 MB je Lauf, und der Actions-Runner holt
bei GeoSphere nur ~0,5 MB/s — 31 s je Schritt, nach 20 Minuten bei +27 h
abgebrochen (2026-11-23, zwei Deploys). Lokal geht dasselbe in ~5 min. Der
Alpenraum passt mit allen 11 Größen in EINE Abfrage (6,4 Mio. Punkte), halb so
viele Daten und halb so viele Abfragen (61 je Lauf, Grenze 240 je Stunde).

Gemessen 2026-11-23:
  * 16 Parameter, KEINE Druckflächen, kein Taupunkt (nur `2r`), keine
    Wolkenschichten (nur `tcc`), keine Schneehöhe, kein Bodendruck. Läufe alle 3 h,
    0–60 h stündlich, regelmäßiges Gitter 945 × 1300 (0,009° × 0,0135°),
    43,0–51,5° N / 5,03–22,57° O, lückenlos. Bereitstellung ~5 h nach Init.
  * Einheiten im NetCDF: `2t` °C, `2r` %, `msl` Pa, `10u`/`10v`/`10fg` m/s,
    `tcc` %, `cape` m²/s² (= J/kg), `tp`/`sf` kg/m² (= mm) für die LETZTE STUNDE
    (hier seit Init aufsummiert wie `tot_prec` bei ICON), `snowlmt` m.
  * `snowlmt` heißt „height above ground", ist aber über NN (gegen ICON-D2
    gemessen 2026-11-10: Differenz hängt nicht von der Geländehöhe ab).
  * Je Abfrage höchstens 10 Mio. Datenpunkte (Punkte × Termine × Größen). Das
    ganze Gebiet sind 1,23 Mio. Punkte je Feld, der Alpenraum 0,58 Mio. → alle
    11 Größen in einer Abfrage (~6 MB NetCDF). Grenze 240 Abfragen je Stunde
    und 5 je Sekunde (Header `x-ratelimit-*`).

Aufruf (aus dem Repo-Wurzelverzeichnis):
  python3 scripts/arome-ingest.py              neuesten Lauf holen
  python3 scripts/arome-ingest.py --latest     nur die Lauf-Kennung ausgeben
  python3 scripts/arome-ingest.py --run 2026112306 [--steps 4]
"""

from __future__ import annotations

import argparse
import http.client
import json
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

from nwp_common import dewpoint_from_rh, ingest, run_id

MODEL = 'arome-at'
LABEL = 'C-LAEF 1 km'
API = 'https://dataset.api.hub.geosphere.at/v1/grid/forecast/nwp-v2-1h-1km'
# lat_s, lon_w, lat_n, lon_e — die Ansicht „Alpen" (`GLOBE_VIEWS` in
# src/config/globe.ts), im Westen auf den Rand des Datensatzes gekappt
BBOX = (44.3, 5.03, 49.8, 17.8)
# EINE Abfrage je Schritt: 0,58 Mio. Punkte × 11 Größen = 6,4 Mio. (< 10 Mio.)
GROUPS = (('2t', '2r', 'msl', '10u', '10v', '10fg', 'tcc', 'cape', 'snowlmt', 'tp', 'sf'),)
STEPS = list(range(0, 61))
VARIABLES = {
    't2m', 'td2m', 'msl', 'precip', 'precipsum', 'newsnow', 'precipphase',
    'wind10', 'uv10', 'gust', 'tcc', 'cape',
}
UA = {'User-Agent': 'meteo-workbench ingest'}
# Höchstens 6 Abfragen gleichzeitig: die Grenze von 5 je Sekunde zählt STARTS, eine
# Abfrage dauert lokal ~6 s, vom Runner aus ein Vielfaches — dort zählt der
# Durchsatz je Verbindung, mehr parallel hilft
GATE = threading.Semaphore(6)
# netCDF4/HDF5 ist NICHT threadsicher: gleichzeitiges Dekodieren in mehreren
# Threads hing still (2026-11-23: im Deploy bei +27 h bis zur Frist, lokal bei
# +24 h) oder stürzte mit Speicherzugriffsfehler ab. Geladen wird parallel,
# dekodiert nacheinander (~0,2 s je Abfrage).
NC_LOCK = threading.Lock()


def get(url: str, timeout: float = 180, tries: int = 5) -> bytes:
    for attempt in range(tries):
        try:
            with GATE, urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        # `IncompleteRead` (abgerissene Übertragung) ist eine `HTTPException`, kein
        # `OSError` — ohne sie hier brach EIN wackliger Download den ganzen Lauf ab
        except (urllib.error.URLError, OSError, http.client.HTTPException) as e:
            if isinstance(e, urllib.error.HTTPError) and e.code not in (429, 500, 502, 503, 504):
                raise RuntimeError(f'HTTP {e.code}: {e.read()[:300]!r}') from e
            if attempt == tries - 1:
                raise
            print(f'  Abruf gescheitert ({e!r:.120}), Versuch {attempt + 2}/{tries}', flush=True)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError('unreachable')


def reftimes() -> list[datetime]:
    meta = json.loads(get(f'{API}/metadata', timeout=30))
    return sorted(
        (datetime.fromisoformat(t).astimezone(timezone.utc) for t in meta['available_forecast_reftimes']),
        reverse=True,
    )


def fetch_group(run: datetime, offset: int, step: int, params: tuple[str, ...]):
    """Eine Abfrage: die Größen `params` zu EINEM Schritt, plus Raster."""
    t = run + timedelta(hours=step)
    url = (
        f'{API}?parameters={",".join(params)}&bbox={",".join(map(str, BBOX))}&output_format=netcdf'
        f'&forecast_offset={offset}&start={t:%Y-%m-%dT%H:%M}&end={t:%Y-%m-%dT%H:%M}'
    )
    data = get(url)
    with NC_LOCK:
        return decode(data, step, params)


def decode(data: bytes, step: int, params: tuple[str, ...]):
    import netCDF4
    import numpy as np

    ds = netCDF4.Dataset('claef.nc', memory=data)
    try:
        lead = np.asarray(ds['leadtime'][:], float)
        if list(np.round(lead).astype(int)) != [step]:
            raise RuntimeError(f'Schritt {lead} statt {step} — Lauf gewechselt?')
        lat = np.asarray(ds['lat'][:], float)
        lon = np.asarray(ds['lon'][:], float)
        grid = {
            'ni': len(lon), 'nj': len(lat),
            'lon0': round(float(lon[0]), 6), 'lat0': round(float(lat[0]), 6),
            'dlon': round(float(lon[1] - lon[0]), 6), 'dlat': round(float(lat[1] - lat[0]), 6),
            'global': False,
        }
        return {p: np.ma.filled(ds[p][0].astype(np.float32), np.nan) for p in params}, grid
    finally:
        ds.close()


def main() -> None:
    import numpy as np

    ap = argparse.ArgumentParser()
    ap.add_argument('--latest', action='store_true', help='nur die Kennung des neuesten Laufs ausgeben')
    ap.add_argument('--run', help='Lauf YYYYMMDDHH statt des neuesten')
    ap.add_argument('--steps', type=int, help='nur die ersten N Schritte (Entwicklung)')
    args = ap.parse_args()

    runs = reftimes()
    run = datetime.strptime(args.run, '%Y%m%d%H').replace(tzinfo=timezone.utc) if args.run else runs[0]
    if args.latest:
        print(run_id(run))
        return
    if run not in runs:
        raise SystemExit(f'Lauf {run_id(run)} nicht (mehr) im Datensatz: {[run_id(r) for r in runs]}')
    # `forecast_offset` zählt die Läufe rückwärts ab dem neuesten
    offset = runs.index(run)
    steps = STEPS[: args.steps] if args.steps else STEPS

    # Die Summen seit Init brauchen den vorigen Schritt: abgerufen wird parallel,
    # aufsummiert in Reihenfolge (jeder Schritt wartet auf die Summe des vorigen)
    cum: dict[int, tuple] = {}
    done = {s: threading.Event() for s in steps}

    def fetch_step(step: int, pool):
        # `done` wird IMMER gesetzt, auch wenn der Abruf scheitert: sonst warteten
        # die folgenden Schritte ewig auf ihn, das Beenden des Pools wartete auf
        # sie, und der Lauf HING ohne Fehlermeldung (2026-11-23: lokal bei +24 h,
        # im Deploy bei +27 h bis zur Frist). Fehlt die Summe des vorigen
        # Schritts, scheitert der nächste mit Meldung statt zu warten.
        try:
            return fetch_step_inner(step, pool)
        finally:
            done[step].set()

    def fetch_step_inner(step: int, pool):
        parts = [pool.submit(fetch_group, run, offset, step, g) for g in GROUPS]
        f, grid = {}, None
        for p in parts:
            vals, g = p.result()
            if grid is not None and g != grid:
                raise RuntimeError(f'Raster wechselt bei +{step} h')
            grid = g
            f.update(vals)
        i = steps.index(step)
        if i:
            done[steps[i - 1]].wait()
            if steps[i - 1] not in cum:
                raise RuntimeError(f'+{steps[i - 1]} h gescheitert, Summe für +{step} h fehlt')
            ptp, psf = cum.pop(steps[i - 1])
        else:
            ptp = psf = np.zeros_like(f['tp'])
        # fehlende Werte zählen 0, bleiben aber fehlend (Modellrand durchsichtig).
        # Bei +0 fehlen `tp`/`sf` überall (kein Intervall) — die Summe ist dort 0,
        # sonst wäre der Niederschlag bei +1 (Differenz zu +0) überall leer
        tp = ptp + np.nan_to_num(f['tp'])
        sf = psf + np.nan_to_num(f['sf'])
        cum[step] = (tp, sf)
        if step == 0:
            f['tp'] = np.zeros_like(tp)
            f['sf'] = np.zeros_like(sf)
        t2m = f['2t'] + 273.15
        print(f'  +{step} h geholt', flush=True)
        return {
            '_grid': grid,
            't2m': t2m,
            'td2m': dewpoint_from_rh(t2m, f['2r']),
            'msl': f['msl'],
            'u10': f['10u'], 'v10': f['10v'],
            # Böe der letzten Stunde; bei +0 gibt es kein Intervall
            'gust': f['10fg'], 'gust_hours': 1 if step else 0,
            'tcc': f['tcc'],
            'cape': f['cape'],
            'tp': np.where(np.isnan(f['tp']), np.nan, tp),
            'sf': np.where(np.isnan(f['sf']), np.nan, sf),
            'snowlmt': f['snowlmt'],
        }

    ingest(
        MODEL, LABEL, run, steps, fetch_step,
        step_window=6, field_workers=8, encode_workers=6,
        only=VARIABLES,
        optional={'precip', 'precipsum', 'newsnow', 'precipphase', 'gust'},
    )


if __name__ == '__main__':
    main()
