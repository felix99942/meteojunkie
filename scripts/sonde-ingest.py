"""Ingest GEMESSENER Radiosondenaufstiege → statische JSONs unter public/sondes/
(Soundings-Bereich, Vergleich Modell ↔ Messung im Skew-T).

QUELLE: DWD Open Data, `weather/weather_reports/radiosonde/bufr/` — der
GTS-Eingang des DWD als BUFR, also die Meldungen ALLER Wetterdienste, nicht
nur der deutschen; überwiegend hochaufgelöst (Messpunkt alle 1–2 s, bis
~7.000 Punkte). Vorgehalten werden rund zwei Tage (~425 Dateien, ~240 MB).

WARUM NICHT MEHR UWYO (bis 2026-10-09): die University of Wyoming lieferte
vom GitHub-Runner aus stundenweise NICHTS (drei Läufe hintereinander null
Aufstiege, während derselbe Abruf lokal 21/21 Stationen brachte), und ein
leerer Lauf ersetzte den letzten guten Stand. Der DWD ist vom Runner aus
verlässlich (MOSMIX, ICON kommen von dort), und sein Strom ist VOLLSTÄNDIGER:
Graz und Linz, Ljubljana, Rivolto (Udine), Novara und Altenstadt fehlten bei
UWyo ganz (gemessen 2026-10-09).

INNSBRUCK STEIGT NUR EINMAL TÄGLICH AUF (02:15 UTC), Graz ebenso (02:14) —
das ist der Startplan, nicht eine Lücke der Quelle: im GTS-Strom stehen keine
weiteren Aufstiege. Wien steigt zweimal (≈ 11:30 / 23:30), Lindenberg und
Idar-Oberstein alle 6 h.

KEIN CORS beim DWD → Ingest im Deploy, Ergebnis gitignored, Browser lädt
same-origin. Python, weil BUFR einen Dekoder braucht: eccodes ist für die
Modellkarten ohnehin installiert.

DREI FALLEN, alle gemessen:
  * ABSTIEGE: nach dem Platzen misst die Sonde weiter und wird als eigene
    Meldung verteilt (Vorlage 309056, Druck STEIGEND). Ohne Filter stand ein
    „Aufstieg" um 12:08 neben dem echten von 10:45. Genommen werden nur
    Aufstiegsvorlagen, und der Druck muss fallen.
  * TEILMELDUNGEN: ein Aufstieg kommt in Stufen — erst bis 100 hPa, später
    vollständig bis zum Platzen. Je Station und Startzeit gilt die Meldung
    mit den meisten Punkten.
  * DER TERMIN STEHT NICHT DRIN: die Meldung trägt die Startzeit (und eine
    „typische" Stunde, die nur die Startstunde ist). Termin = der letzte
    3-h-Termin bis 1¾ h nach dem Start (`term_of`) — gestartet wird 45–75 min
    vor dem Termin, Cuneo ~1¾ h; Innsbruck (02:15) wird so zu 03 UTC, was
    seiner Flugzeit näher liegt als das 00 UTC, unter dem UWyo es führte.

DEKODIEREN IST TEUER (alle Meldungen auspacken, weltweit — ~8 min für zwei
Tage auf einem Kern): je BUFR-Datei wird das Ergebnis in `.cache/sondes/`
abgelegt (im Deploy über den Actions-Cache), ein stündlicher Lauf dekodiert
also nur die neuen Dateien. Gecacht wird für ALLE europäischen Stationen,
nicht nur die gelisteten — sonst entwertete jede Änderung der Liste den Cache.

  python3 scripts/sonde-ingest.py
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nwp_common import http_get  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / 'public' / 'sondes'
CACHE_DIR = ROOT / '.cache' / 'sondes'
BASE = 'https://opendata.dwd.de/weather/weather_reports/radiosonde/bufr/'

# Stationsliste — alle im DWD-Strom GEMESSEN (2026-10-09), Namen zur Anzeige.
# Die Lage kommt aus der Meldung, nicht von hier. Nicht dabei, weil dort
# nichts kommt: Udine 16044, Mailand 16080, Uccle 06447, Nancy 07180,
# Lyon 07481.
STATIONS = [
    ('11035', 'Wien Hohe Warte', 'AT'),
    ('11120', 'Innsbruck', 'AT'),
    ('11240', 'Graz', 'AT'),
    ('11010', 'Linz', 'AT'),
    ('10868', 'München', 'DE'),
    ('10954', 'Altenstadt', 'DE'),
    ('10739', 'Stuttgart', 'DE'),
    ('10771', 'Kümmersbruck', 'DE'),
    ('10548', 'Meiningen', 'DE'),
    ('10618', 'Idar-Oberstein', 'DE'),
    ('10410', 'Essen', 'DE'),
    ('10304', 'Meppen', 'DE'),
    ('10393', 'Lindenberg', 'DE'),
    ('10238', 'Bergen', 'DE'),
    ('10184', 'Greifswald', 'DE'),
    ('10035', 'Schleswig', 'DE'),
    ('10113', 'Norderney', 'DE'),
    ('06610', 'Payerne', 'CH'),
    ('06260', 'De Bilt', 'NL'),
    ('11520', 'Praha-Libuš', 'CZ'),
    ('11747', 'Prostějov', 'CZ'),
    ('11952', 'Poprad', 'SK'),
    ('12843', 'Budapest', 'HU'),
    ('12425', 'Wrocław', 'PL'),
    ('12374', 'Legionowo', 'PL'),
    ('14015', 'Ljubljana', 'SI'),
    ('14240', 'Zagreb', 'HR'),
    ('16045', 'Rivolto (Udine)', 'IT'),
    ('16064', 'Novara-Cameri', 'IT'),
    ('16113', 'Cuneo', 'IT'),
    ('07145', 'Trappes', 'FR'),
]

# WMO-Blöcke, die in den Cache gehen (West-, Mittel- und Südosteuropa).
CACHE_BLOCKS = {6, 7, 10, 11, 12, 13, 14, 16}
# Aufstiegsvorlagen (309052 hochaufgelöst, 309057 DWD-Fassung). 309056 ist
# der ABSTIEG und fällt heraus.
ASCENT_TEMPLATES = {309052, 309057}
TOP_HPA = 100  # Oberes Ende der Skew-T-Achse
MAX_AGE_H = 48
MISSING = 1e90


def term_of(launch: datetime) -> datetime:
    """Letzter 3-h-Termin bis 1¾ h nach dem Start."""
    t = launch + timedelta(minutes=105)
    return t.replace(hour=t.hour - t.hour % 3, minute=0, second=0, microsecond=0)


def thin(p, z, T, Td, wdir, wspd):
    """Ausdünnen auf ECHTE Messpunkte: ein Punkt, sobald der Druck um 2 hPa
    (über 300 hPa: 1 hPa) gefallen ist; Druck STRENG fallend (pendelt der
    Ballon, liefe die Kurve sonst zurück); Schluss bei 100 hPa. Kein Mitteln,
    kein Gitter — jeder Punkt bleibt eine Messung."""
    out = {'p': [], 'z': [], 'T': [], 'Td': [], 'dir': [], 'spd': []}
    last = float('inf')
    for i in range(len(p)):
        if p[i] is None or T[i] is None:
            continue
        if p[i] < TOP_HPA:
            break
        step = 2 if p[i] > 300 else 1
        if out['p'] and p[i] > last - step:
            continue
        last = p[i]
        out['p'].append(round(p[i], 1))
        out['z'].append(None if z[i] is None else round(z[i]))
        out['T'].append(round(T[i], 1))
        out['Td'].append(None if Td[i] is None else round(Td[i], 1))
        out['dir'].append(None if wdir[i] is None else round(wdir[i]))
        out['spd'].append(None if wspd[i] is None else round(wspd[i], 1))
    return out


def decode_file(path: str) -> list[dict]:
    """Alle Aufstiege europäischer Stationen aus einer BUFR-Datei."""
    import eccodes

    def arr(h, key):
        try:
            return list(eccodes.codes_get_array(h, key))
        except Exception:
            return None

    def first(h, key):
        a = arr(h, key)
        return a[0] if a else None

    def clean(a, f=lambda v: v):
        return [None if v is None or abs(v) > MISSING or v == 2147483647 else f(v) for v in a]

    found = []
    with open(path, 'rb') as fh:
        while True:
            try:
                h = eccodes.codes_bufr_new_from_file(fh)
            except Exception:
                break
            if h is None:
                break
            try:
                tmpl = arr(h, 'unexpandedDescriptors') or []
                if not ASCENT_TEMPLATES.intersection(int(x) for x in tmpl):
                    continue
                eccodes.codes_set(h, 'unpack', 1)
                blk, st = first(h, 'blockNumber'), first(h, 'stationNumber')
                if blk is None or st is None or int(blk) not in CACHE_BLOCKS:
                    continue
                y, mo, d, hh, mi = (first(h, k) for k in ('year', 'month', 'day', 'hour', 'minute'))
                launch = datetime(int(y), int(mo), int(d), int(hh), int(mi), tzinfo=timezone.utc)
                # Länge aus der TEMPERATUR, nicht aus dem Druck: in der
                # DWD-Vorlage 309057 hängt hinter der Messreihe ein weiterer
                # Druckwert (Tropopause/Maximalwind), `pressure` ist dort um
                # eins länger. Mit dem Druck als Länge lief der Index über, und
                # die ganze Meldung fiel still heraus — bei acht deutschen
                # Stationen. Die Reihen beginnen gemeinsam, gekürzt wird hinten.
                T = clean(arr(h, 'airTemperature') or [], lambda v: v - 273.15)
                n = len(T)
                if n < 5:
                    continue

                def series(key, f=lambda v: v):
                    a = arr(h, key)
                    return clean(a[:n], f) + [None] * (n - len(a)) if a else [None] * n

                p = series('pressure', lambda v: v / 100)
                z = series('nonCoordinateGeopotentialHeight')
                Td = series('dewpointTemperature', lambda v: v - 273.15)
                wd = series('windDirection')
                ws = series('windSpeed')
                valid = [p[i] for i in range(n) if p[i] is not None and T[i] is not None]
                # Druck muss FALLEN — sonst ist es ein Abstieg unter anderer Vorlage
                if len(valid) < 5 or valid[0] < valid[-1] + 50:
                    continue
                data = thin(p, z, T, Td, wd, ws)
                if len(data['p']) < 5:
                    continue
                found.append({
                    'id': f'{int(blk):02d}{int(st):03d}',
                    'launch': launch.isoformat().replace('+00:00', 'Z'),
                    'lat': round(float(first(h, 'latitude')), 4),
                    'lon': round(float(first(h, 'longitude')), 4),
                    'points': n,
                    **data,
                })
            except Exception:
                pass
            finally:
                eccodes.codes_release(h)
    return found


def main() -> int:
    listing = http_get(BASE).decode('utf-8', 'replace')
    names = sorted(set(re.findall(r'href="(Z__C_[^"]+\.bin)"', listing)))
    if not names:
        print('Radiosonden: Verzeichnis beim DWD leer oder unlesbar.', file=sys.stderr)
        return 1
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    have = {f.stem for f in CACHE_DIR.glob('*.json')}
    new = [n for n in names if n[:-4] not in have]

    # Neue Dateien holen (Netz, parallel) und dekodieren (CPU, je Kern einer)
    tmp = CACHE_DIR / 'bufr-tmp'
    tmp.mkdir(exist_ok=True)

    def fetch(name: str) -> Path | None:
        try:
            target = tmp / name
            target.write_bytes(http_get(BASE + name))
            return target
        except Exception:
            return None

    with ThreadPoolExecutor(8) as ex:
        paths = [x for x in ex.map(fetch, new) if x]
    failed = len(new) - len(paths)
    with ProcessPoolExecutor(os.cpu_count() or 2) as ex:
        for path, found in zip(paths, ex.map(decode_file, map(str, paths), chunksize=4)):
            (CACHE_DIR / (path.stem + '.json')).write_text(json.dumps(found))
    shutil.rmtree(tmp, ignore_errors=True)

    # Was der DWD nicht mehr vorhält, fliegt aus dem Cache
    keep = {n[:-4] for n in names}
    for f in CACHE_DIR.glob('*.json'):
        if f.stem not in keep:
            f.unlink()

    # Je Station und Termin die vollständigste Meldung
    wanted = {sid for sid, _, _ in STATIONS}
    cutoff = datetime.now(timezone.utc) - timedelta(hours=MAX_AGE_H)
    best: dict[tuple[str, str], dict] = {}
    for f in CACHE_DIR.glob('*.json'):
        for s in json.loads(f.read_text()):
            if s['id'] not in wanted:
                continue
            launch = datetime.fromisoformat(s['launch'].replace('Z', '+00:00'))
            if launch < cutoff:
                continue
            term = term_of(launch).isoformat().replace('+00:00', 'Z')
            key = (s['id'], term)
            if key not in best or s['points'] > best[key]['points']:
                best[key] = {**s, 'term': term}

    shutil.rmtree(OUT_DIR, ignore_errors=True)
    OUT_DIR.mkdir(parents=True)
    index = {
        'generated': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'source': 'Deutscher Wetterdienst, Open Data (GTS-Radiosondenmeldungen, BUFR)',
        'stations': [],
    }
    files = 0
    for sid, name, country in STATIONS:
        mine = sorted((v for (i, _), v in best.items() if i == sid), key=lambda v: v['term'], reverse=True)
        if not mine:
            continue  # ohne Aufstieg kennt der Index die Station nicht
        soundings = []
        for s in mine:
            stamp = s['term'][:13].replace('-', '').replace('T', '')
            file = f'{sid}-{stamp}.json'
            body = {k: s[k] for k in ('term', 'launch', 'lat', 'lon', 'p', 'z', 'T', 'Td', 'dir', 'spd')}
            (OUT_DIR / file).write_text(json.dumps({'id': sid, **body}, separators=(',', ':')))
            files += 1
            soundings.append({'term': s['term'], 'launch': s['launch'], 'top': s['p'][-1], 'file': file})
        first = mine[0]
        index['stations'].append({
            'id': sid, 'name': name, 'country': country,
            'lat': first['lat'], 'lon': first['lon'], 'elev': first['z'][0] if first['z'][0] is not None else 0,
            'soundings': soundings,
        })
    (OUT_DIR / 'index.json').write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')))
    print(
        f'Radiosonden: {files} Aufstiege von {len(index["stations"])}/{len(STATIONS)} Stationen '
        f'({len(new)} neue BUFR-Dateien, {failed} nicht ladbar, {len(names)} beim DWD)'
    )
    missing = [n for sid, n, _ in STATIONS if not any(s['id'] == sid for s in index['stations'])]
    if missing:
        print(f'  ohne Aufstieg in {MAX_AGE_H} h: {", ".join(missing)}')
    if not index['stations']:
        print('Radiosonden: KEINE Station — Quelle prüfen.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
