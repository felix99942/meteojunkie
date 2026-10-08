#!/usr/bin/env python3
"""ECMWF IFS 0,25° (Open Data) → Wertebilder für die Modellkarten (Globus).

Warum nicht über Open-Meteo: ein Gitter kostet dort ~Punktzahl Calls, ein
globales 1°-Feld also ~65.000 — das Tagesbudget sind 10.000. ECMWF Open Data
(CC BY 4.0) hat kein solches Limit, liefert aber GRIB2 mit CCSDS-Kompression,
das man im Browser nicht dekodieren will. Deshalb läuft dieser Schritt im
Deploy (wie MOSMIX und die Radiosonden), und der Browser bekommt fertige
Wertebilder same-origin.

Gemessen 2026-10-05:
  * je Lauf und Schritt eine GRIB-Datei (~146 MB) plus `.index` (JSON-Zeilen
    mit `_offset`/`_length`) — geholt wird je Feld nur sein Byte-Bereich
    (0,5–0,9 MB). Ein Abruf ~0,4 s.
  * 00/12 UTC: 85 Schritte (3 h bis +144, 6 h bis +360). 06/18 UTC reichen
    nur bis +90 h und werden hier NICHT genommen — ein Globus, dessen
    Zeitachse je nach Tageszeit zwischen 4 und 15 Tagen springt, wäre
    verwirrender als ein sechs Stunden älterer Lauf.
  * Verzug ~7,5 h nach Init.
  * Raster 1440×721, Zeile 0 = 90° N, Spalte 0 = 180° W (gemeldet als 180),
    nach Osten.
  * Böen-Intervall wechselt (stepRange, gemessen): bis +90 h die LETZTE
    Stunde vor dem Termin (`2-3`), +93…+144 drei Stunden (`10fg3`), ab +150
    sechs. Es wird je Schritt aus dem GRIB übernommen und in meta.json
    abgelegt; bei +0 (stepRange „0") gibt es keine Böe.

Ausgabe, Kodierung und Pipeline: `nwp_common.py` → public/nwp/ecmwf-ifs/.

Aufruf (aus dem Repo-Wurzelverzeichnis):
  python3 scripts/ecmwf-ingest.py            neuesten vollständigen Lauf holen
  python3 scripts/ecmwf-ingest.py --latest   nur die Lauf-Kennung ausgeben (für den Actions-Cache)
  python3 scripts/ecmwf-ingest.py --run 2026100500   genau diesen Lauf holen

Abhängigkeiten: scripts/requirements-nwp.txt (eccodes bringt die Bibliothek
im pip-Paket mit, kein Systempaket nötig).
"""

from __future__ import annotations

import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from nwp_common import Missing, decode_grib, http_get, ingest, run_id, url_exists

MODEL = 'ecmwf-ifs'
BASE = 'https://data.ecmwf.int/forecasts'
STEPS = list(range(0, 145, 3)) + list(range(150, 361, 6))

# GRIB-Felder (param, levelist) → einheitlicher Name aus nwp_common
FIELDS = {
    ('2t', None): 't2m',
    ('t', '850'): 't850',
    ('msl', None): 'msl',
    ('tp', None): 'tp',
    ('10u', None): 'u10',
    ('10v', None): 'v10',
    ('10fg', None): 'gust',
    ('gh', '500'): 'gh500',
    ('tcc', None): 'tcc',
    ('skt', None): 'skt',
}

# Wellenmodell (WAM): eigener Strom `wave` im selben Verzeichnis, gleiches
# 0,25°-Gitter, gleiche Schritte (gemessen 2026-10-08, +0 bis +360 h); über
# Land kein Wert (36 % der Punkte). Je Feld ~0,8–1 MB Abruf.
WAVE_FIELDS = {
    ('swh', None): 'swh',
    ('mwd', None): 'mwd',
    ('pp1d', None): 'pp1d',
}

# Dieselbe Größe unter wechselndem Namen — gemessen 2026-10-05: die Böe heißt
# bis +90 und ab +150 `10fg`, von +93 bis +144 aber `10fg3`. Ohne die Zuordnung
# fehlten Böen-Schritte still.
PARAM_ALIASES = {'10fg3': '10fg', '10fg6': '10fg'}


def run_dir(run: datetime) -> str:
    return f"{BASE}/{run:%Y%m%d}/{run:%H}z/ifs/0p25/oper/"


def step_file(run: datetime, step: int, stream: str = 'oper') -> str:
    base = run_dir(run).replace('/oper/', f'/{stream}/')
    return f"{base}{run:%Y%m%d%H}0000-{step}h-{stream}-fc"


def run_complete(run: datetime) -> bool:
    """Vollständig = der LETZTE Schritt ist da (die Dateien erscheinen der Reihe nach)."""
    return url_exists(step_file(run, STEPS[-1]) + '.index')


def latest_run(now: datetime) -> datetime:
    base = now.replace(minute=0, second=0, microsecond=0)
    base = base.replace(hour=12 if base.hour >= 12 else 0)
    for i in range(6):  # bis drei Tage zurück
        run = base - timedelta(hours=12 * i)
        if run_complete(run):
            return run
    raise SystemExit('kein vollständiger ECMWF-Lauf in den letzten drei Tagen gefunden')


def fetch_step(run: datetime, step: int, pool: ThreadPoolExecutor) -> dict:
    """Alle Felder eines Schritts unter einheitlichen Namen, plus `_grid`."""
    import numpy as np

    futures = {}
    for stream, fields in (('oper', FIELDS), ('wave', WAVE_FIELDS)):
        url = step_file(run, step, stream)
        try:
            index = [json.loads(line) for line in http_get(url + '.index').decode().splitlines() if line.strip()]
        except Missing:
            if stream == 'oper':
                raise
            continue  # Wellen fehlen zu diesem Schritt — die übrigen Größen bleiben
        rows = {}
        for row in index:
            key = (PARAM_ALIASES.get(row['param'], row['param']), row.get('levelist'))
            if key in fields and key not in rows:
                rows[key] = row
        for key, row in rows.items():
            futures[fields[key]] = pool.submit(http_get, url + '.grib2', (row['_offset'], row['_length']))
    out: dict = {}
    for name, fut in futures.items():
        try:
            vals, grid, hours = decode_grib(fut.result())
        except Missing:
            continue
        out['_grid'] = grid
        if name == 'tp':
            out[name] = vals * 1000.0  # m → mm, doppelt genau (wird differenziert)
        elif name == 'tcc':
            # ECMWF Open Data führt die Bedeckung als ANTEIL 0–1, nicht in %
            # (gemessen 2026-10-08: min 0, max 1, Mittel 0,66). Ohne den Faktor
            # rundete die 5-%-Kodierung alles auf 0 — die IFS-Bewölkung stand
            # überall auf wolkenlos.
            out[name] = (vals * 100.0).astype(np.float32)
        else:
            out[name] = vals.astype(np.float32)
        if name == 'gust':
            out['gust_hours'] = hours
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--latest', action='store_true', help='nur die Kennung des neuesten Laufs ausgeben')
    ap.add_argument('--run', help='Lauf YYYYMMDDHH statt des neuesten (der Deploy gibt die Kennung weiter, die er schon als Cache-Schlüssel benutzt)')
    ap.add_argument('--steps', type=int, default=len(STEPS), help='nur die ersten N Schritte (Entwicklung)')
    args = ap.parse_args()

    if args.run:
        run = datetime.strptime(args.run, '%Y%m%d%H').replace(tzinfo=timezone.utc)
    else:
        run = latest_run(datetime.now(timezone.utc))
    if args.latest:
        print(run_id(run))
        return
    ingest(MODEL, 'ECMWF IFS', run, STEPS[: args.steps], lambda s, pool: fetch_step(run, s, pool))


if __name__ == '__main__':
    main()
