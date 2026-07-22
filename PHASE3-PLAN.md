# Phase 3 „Synoptische Workbench" — Architektur-Notiz & Umsetzungsplan (Schritt 0)

Ergebnis der Repo-Inventur gegen das Briefing
(`synoptischeworkbenchphase3prompt.md`). **Noch kein Code — wartet auf
Freigabe.**

---

## 1. Inventur: Was tatsächlich existiert

Das Briefing beschreibt in „Kontext" ein anderes Projekt als dieses Repo:

| Briefing-Annahme | Realität in diesem Repo |
|---|---|
| Phase 1: Meteogramme aus **ECMWF Open Data** (GRIB) | Meteogramme aus der **Open-Meteo REST-API** (JSON), Multi-Modell-Vergleich |
| Phase 2: eigener GRIB-Ingest (ICON, GFS …) | Kartenfelder via Open-Meteo **Multi-Location-Gitter**, clientseitiges Rendering (`fieldImage.ts`) |
| Python-Backend wahrscheinlich vorhanden | **Kein Backend.** Reine Static-Site (SPEC §2); Backend-Proxy ist explizit „nächster Schritt", nicht Bestand (SPEC §5) |
| cfgrib/xarray/eccodes-Utilities wiederverwenden | Es gibt keinerlei Python/GRIB-Code |

Vorhandener Stack: Vite + React 19 + TS (strict), Zustand, TanStack Query,
uPlot, MapLibre mit **lokaler Basemap** (Natural Earth, Casing-Grenzen),
IndexedDB-Gittercache, Request-Queue (max. 2), 429-Backoff,
Verbrauchszähler, Mock-Modus (`?mock=1`, `?mockres=N`), Presets
(localStorage + Export/Import, builtin-fähig).

## 2. Was vom Briefing bereits existiert (nicht duplizieren!)

| Briefing-Schritt | Status |
|---|---|
| 3×2-Grid, Panel-Komponente | ✅ vorhanden |
| Synchronisiertes Pan/Zoom | ✅ `sharedView` + SYNC-Button |
| Zeitschieber + Play/Pause + Tastatur | ✅ `TimeScrubber` |
| Domain-Presets | ✅ Europa/Österreich (bewusst nur zwei, SPEC §3) |
| Layout-/Panel-Presets als JSON, erweiterbar ohne Code | ✅ `presets.ts` inkl. `builtin`-Mechanismus — genau der Landeplatz für „Synoptische Übersicht"/„Konvektion"/„Winter" |
| Klick auf Karte → Meteogramm | ✅ Location-Lock; Meteogramme sind Panels, kein Popup |
| Feld-Registry-Idee | ✅ teilweise: `models.ts`/`variables.ts`/`colorscales.ts` — fehlt: Overlay-/Kontur-/Barbs-Beschreibung pro Panel („FieldSpec light") |
| Colormaps mit dataviz-Skill | ✅ validierte Skalen in `colorscales.ts` |
| Cache/Prefetch/Ladezustände | ✅ IDB-Cache, Queue, per-Panel-Status |

**Neu wäre die meteorologische Substanz:** Druckflächen-Felder, abgeleitete
Größen, Kontur-Overlays, Windpfeile, Fill+Overlay-Komposition pro Panel,
synoptische Presets, Modelllauf-Auswahl, Punkt-Readout über alle Panels.

## 3. Datenlage (live verifiziert, heute)

- Open-Meteo liefert die nötigen **Druckflächen-Variablen über dieselbe
  Forecast-API**: `temperature_850hPa`, `geopotential_height_{1000,850,500,300}hPa`,
  `wind_speed/направление_{850,300}hPa`, `relative_humidity_700hPa` — geprüft
  für `ecmwf_ifs025` (9/9) und `icon_eu` (9/9).
- **AIFS (`ecmwf_aifs025`): 0/9** Druckflächen-Variablen (HTTP 200 mit
  Nullen — die bekannte §6-Falle). AIFS taugt hier nur für Bodenfelder.
- **Nicht verfügbar:** Vorticity (`vo`). Ableitung aus dem Windfeld wäre bei
  ~150 km Gitterweite (Europa 25×25) meteorologisch fragwürdig → Vorschlag:
  Panel 1 des Default-Presets ersetzen (z.B. GH500-Konturen über
  T850-Advektion oder 500-hPa-Wind) oder Vorticity auf Option B verschieben.
- Ableitungen, die clientseitig sauber gehen: **rr3h/rr6h** (Summe der
  Stunden-Raten — kein tp-Dekumulieren nötig, Open-Meteo liefert Raten),
  **Schichtdicke 1000–500** (gh500 − gh1000, zwei Gitter), **Wind kn**
  (Einheit), **Isolinien** via Marching Squares auf unseren kleinen Gittern.

## 4. Die eigentliche Entscheidung: zwei Wege

### Option A — Frontend-only, im bestehenden Stack (empfohlen für Phase 3)
Synoptik-Modus auf Basis der vorhandenen Gitter-Pipeline. Kein neuer
Deployment-Target, alle Schutzmechanismen (Queue, Cache, Mock, Zähler)
greifen weiter. Einschränkungen ehrlich: ~150 km Auflösung Europa (SPEC §4
„Karte ist Übersichtsebene" gilt weiter), keine Vorticity, Budget eng (s. §5).

### Option B — Backend wie im Briefing (FastAPI + ecmwf-opendata + GRIB)
Das ist der in SPEC §5 angelegte **Backend-Proxy-Endzustand**: volle
Auflösung, echte GRIB-Felder inkl. `vo`, serverseitiges Rendering, entkoppelt
vom API-Budget. Aber: neuer Stack (Python), Hosting nötig, widerspricht dem
aktuellen „Kein Backend"-Stand der SPEC und ist deutlich größerer Scope.

**Empfehlung: A jetzt, B als Folgeprojekt** — A liefert die synoptische
Arbeitsfläche schnell und A's Feld-Registry/Panel-Komposition ist exakt die
Abstraktion, unter die später B als zweite Datenquelle geschoben wird.

## 5. Budget-Rechnung (der kritische Punkt von Option A)

Default-Preset braucht ~10–11 eindeutige Gitter (Overlays wie MSLP werden
über Panels geteilt, ein Fetch pro Feld): bei Europa 25×25 = 625 Punkten
⇒ **~6.500 gewichtete Locations pro Modelllauf** — kollidiert mit 600/min
und 5.000/h. Konsequenzen, die ich einplanen würde:
- eigene **Synoptik-Gitterweite** pro Domain (z.B. Europa 18×18 = 324
  ⇒ ~3.400/Lauf), Kartenhorizont 3 Tage wie gehabt;
- Fetch **on-demand pro Panel** (lazy wie bisher), IDB-Cache pro Lauf-Bucket
  — ein Lauf wird genau einmal gezogen, Reloads kostenlos;
- Entwicklung ausschließlich im Mock (`?mock=1`).
Bei intensiver Nutzung über mehrere Läufe/Tag bleibt das Tageslimit (10.000)
der Engpass → das ist das stärkste Argument, B zeitnah anzuschließen.

## 6. Umsetzungsplan Option A (vertikale Slices)

1. **Feld-Registry erweitern** (`FieldSpec`: fill / contour / barbs,
   `derived`, Einheiten-Transform, Referenz auf Farbskala bzw.
   Kontur-Intervalle + highlight wie 540 dam / 0 °C) + Druckflächen-Variablen
   in Registry & Mock (Mock kann sofort alles liefern).
2. **Ableitungsschicht** (rr3h/rr6h, Schichtdicke, kn) mit Unit-Tests —
   erster Testrunner im Projekt (vitest), SPEC-konform „Ableitungen gegen
   Referenz prüfen".
3. **Konturen** (Marching Squares auf `GridField` → Linien in Bild- oder
   Geo-Koordinaten, Labels), als zweiter Layer über dem Fill; **Barbs** als
   ausgedünnte DOM/Canvas-Symbole.
4. **Panel-Komposition**: Panel-Modus „Synoptik" = FieldSpec-Kombination
   (Fill + Kontur + optional Barbs) statt Einzelvariable; Colorbar/Readout.
5. **Synoptik-Presets** als `BUILTIN_PRESETS` („Synoptische Übersicht",
   „Winter", „Konvektion") — Mechanismus existiert.
6. **Modelllauf-Auswahl** über die Single-Runs-API (`runInit` ist im State
   vorbereitet; deckt SPEC §13 „Modelllauf-Auswahl" ab). Erst hier, weil
   eigener API-Endpoint mit eigenen Regeln.
7. **Readout/Probe**: Crosshair-Werte über alle Panels aus den bereits
   geladenen Gittern (kein neuer API-Call nötig — bilineare Abfrage im
   Client).

Jeder Slice endet sichtbar/testbar; Verifikation headless im Mock wie gehabt.

## 7. Offene Fragen vor dem Start (bitte entscheiden)

1. **Option A jetzt, B später** — einverstanden, oder direkt B?
2. **Phase-3-Definition**: Das Briefing (Synoptik-Karten) verdrängt die
   SPEC-§13-Punkte Vertikalprofile & Ensemble-Plumes. Reihenfolge so gewollt?
   (SPEC §13 würde ich entsprechend aktualisieren.)
3. **Panel 1 des Default-Presets** ohne Vorticity: Ersatzvorschlag
   500-hPa-Wind (Fill) + GH500 (Kontur), oder Vorticity numerisch aus dem
   Windfeld trotz grober Auflösung?
4. **Synoptik-Gitterweite** Europa: 18×18 (Budget) vs. 25×25 (Optik)?
5. **Commits**: Das Briefing verlangt Commit je Schritt — das Repo hat noch
   **keinen einzigen Commit**. Soll ich mit einem Initial-Commit des
   aktuellen Stands beginnen?
